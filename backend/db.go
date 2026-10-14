package main

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"io/fs"
	"path"

	_ "github.com/jackc/pgx/v5/stdlib"
)

const (
	StartingBalance = 10_000
	ContractPayout  = 100 // Music Notes paid per winning contract
)

var (
	ErrInsufficientFunds = errors.New("insufficient Music Notes")
	ErrInvalidOrder      = errors.New("side must be yes or no and quantity between 1 and 1,000,000")
	ErrMarketClosed      = errors.New("market is not open")
	ErrChartNotIn        = errors.New("chart for this market has not been ingested")
)

//go:embed migrations/*.sql
var migrations embed.FS

// Migrate applies each migrations/*.sql file once, in filename order.
func Migrate(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version    text PRIMARY KEY,
		applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}

	files, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}

	for _, file := range files {
		if err := applyMigration(ctx, db, file); err != nil {
			return err
		}
	}
	return nil
}

func applyMigration(ctx context.Context, db *sql.DB, file string) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Claiming the version first makes a concurrent migrator wait, then skip.
	res, err := tx.ExecContext(ctx,
		`INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING`, path.Base(file))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil
	}

	body, err := migrations.ReadFile(file)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, string(body)); err != nil {
		return err
	}
	return tx.Commit()
}

type Entry struct {
	UserID   int64
	Amount   int64  // positive credits, negative debits
	Kind     string // grant, buy, or payout
	MarketID *int64
}

// Post applies e to the user's balance and records it in the ledger inside tx,
// returning the new balance. Callers commit tx together with their own writes.
func Post(ctx context.Context, tx *sql.Tx, e Entry) (int64, error) {
	var balance int64
	err := tx.QueryRowContext(ctx,
		`UPDATE balances SET balance = balance + $2, updated_at = now()
		 WHERE user_id = $1 AND balance + $2 >= 0
		 RETURNING balance`,
		e.UserID, e.Amount).Scan(&balance)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrInsufficientFunds
	}
	if err != nil {
		return 0, err
	}

	_, err = tx.ExecContext(ctx,
		`INSERT INTO ledger_entries (user_id, amount, balance_after, kind, market_id)
		 VALUES ($1, $2, $3, $4, $5)`,
		e.UserID, e.Amount, balance, e.Kind, e.MarketID)
	return balance, err
}

// Buy sells quantity YES or NO contracts in an open market to the user at the
// bot's price, returning the new balance.
func Buy(ctx context.Context, db *sql.DB, userID, marketID int64, side string, quantity int64) (int64, error) {
	if side != "yes" && side != "no" {
		return 0, ErrInvalidOrder
	}
	if quantity <= 0 || quantity > 1_000_000 { // the cap keeps price*quantity far from overflow
		return 0, ErrInvalidOrder
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	// FOR SHARE makes Resolve wait for in-flight buys, and buys wait for Resolve.
	var price int64
	var status string
	err = tx.QueryRowContext(ctx,
		`SELECT yes_price, status FROM markets WHERE id = $1 FOR SHARE`, marketID).Scan(&price, &status)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && status != "open") {
		return 0, ErrMarketClosed
	}
	if err != nil {
		return 0, err
	}
	if side == "no" {
		price = ContractPayout - price
	}

	cost := price * quantity
	balance, err := Post(ctx, tx, Entry{UserID: userID, Amount: -cost, Kind: "buy", MarketID: &marketID})
	if err != nil {
		return 0, err
	}
	_, err = tx.ExecContext(ctx,
		`INSERT INTO positions (user_id, market_id, side, quantity, cost_basis)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (user_id, market_id, side) DO UPDATE
		 SET quantity = positions.quantity + EXCLUDED.quantity,
		     cost_basis = positions.cost_basis + EXCLUDED.cost_basis`,
		userID, marketID, side, quantity, cost)
	if err != nil {
		return 0, err
	}
	return balance, tx.Commit()
}

// Resolve settles a market from its chart: winning contracts pay ContractPayout
// each and every position in the market is closed. Resolving twice is a no-op.
// ponytail: nothing calls this yet; trigger it after ingestion loads each chart.
func Resolve(ctx context.Context, db *sql.DB, marketID int64) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var songID, baseline, shift int64
	var chartDate, status string
	err = tx.QueryRowContext(ctx,
		`SELECT song_id, chart_date::text, baseline_rank, shift, status
		 FROM markets WHERE id = $1 FOR UPDATE`, marketID).Scan(&songID, &chartDate, &baseline, &shift, &status)
	if err != nil {
		return err
	}
	if status == "resolved" {
		return nil
	}

	var rank int64
	err = tx.QueryRowContext(ctx,
		`SELECT rank FROM chart_snapshots WHERE song_id = $1 AND chart_date = $2`, songID, chartDate).Scan(&rank)
	if errors.Is(err, sql.ErrNoRows) {
		var chartIn bool
		if err := tx.QueryRowContext(ctx,
			`SELECT EXISTS (SELECT 1 FROM chart_snapshots WHERE chart_date = $1)`, chartDate).Scan(&chartIn); err != nil {
			return err
		}
		if !chartIn {
			return ErrChartNotIn
		}
		rank = 101 // dropped off the chart
	} else if err != nil {
		return err
	}

	moved := baseline - rank // positive = rose
	outcome := "no"
	if (shift > 0 && moved >= shift) || (shift < 0 && moved <= shift) {
		outcome = "yes"
	}

	type win struct{ userID, quantity int64 }
	var wins []win
	rows, err := tx.QueryContext(ctx,
		`SELECT user_id, quantity FROM positions WHERE market_id = $1 AND side = $2
		 ORDER BY user_id`, marketID, outcome) // fixed lock order, so concurrent Resolves can't deadlock
	if err != nil {
		return err
	}
	for rows.Next() {
		var w win
		if err := rows.Scan(&w.userID, &w.quantity); err != nil {
			rows.Close()
			return err
		}
		wins = append(wins, w)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, w := range wins {
		if _, err := Post(ctx, tx, Entry{UserID: w.userID, Amount: w.quantity * ContractPayout, Kind: "payout", MarketID: &marketID}); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM positions WHERE market_id = $1`, marketID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE markets SET status = 'resolved', outcome = $2 WHERE id = $1`, marketID, outcome); err != nil {
		return err
	}
	return tx.Commit()
}

// CreateUser inserts a user funded with the StartingBalance grant.
func CreateUser(ctx context.Context, db *sql.DB, username, email, passwordHash string) (int64, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var id int64
	err = tx.QueryRowContext(ctx,
		`INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
		username, email, passwordHash).Scan(&id)
	if err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO balances (user_id, balance) VALUES ($1, 0)`, id); err != nil {
		return 0, err
	}
	if _, err := Post(ctx, tx, Entry{UserID: id, Amount: StartingBalance, Kind: "grant"}); err != nil {
		return 0, err
	}
	return id, tx.Commit()
}
