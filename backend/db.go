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
	ChartSize       = 100 // Billboard Hot 100; a chart with fewer rows is still loading
)

var (
	ErrInsufficientFunds  = errors.New("insufficient Music Notes")
	ErrMarketClosed       = errors.New("market is not open")
	ErrChartNotIn         = errors.New("chart for this market has not been fully ingested")
	ErrNotEnoughContracts = errors.New("you don't hold that many contracts")
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

	// A database created before the ledger merge recorded the old 001 as applied,
	// so it never gets the market columns. Fail now instead of on the first buy.
	if _, err := db.ExecContext(ctx, `SELECT yes_price, closes_at FROM markets LIMIT 0`); err != nil {
		return errors.New("database has the schema from before the ledger merge; reset it once (README: One-time reset after the ledger merge)")
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
	Kind     string // grant, buy, sell, or payout
	MarketID *int64
	// The contracts a buy, sell or payout moved; empty for grants.
	Side     string
	Quantity int64
	Price    int64 // Music Notes per contract
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
		`INSERT INTO ledger_entries (user_id, amount, balance_after, kind, market_id, side, quantity, price)
		 VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), NULLIF($7, 0), NULLIF($8, 0))`,
		e.UserID, e.Amount, balance, e.Kind, e.MarketID, e.Side, e.Quantity, e.Price)
	return balance, err
}

// Resolve settles a market from its chart: winning contracts pay ContractPayout
// each and every position in the market is closed. Resolving twice is a no-op.
// The chart must be fully loaded (ChartSize rows), so a half-ingested chart
// never counts songs that are still loading as dropped off.
func Resolve(ctx context.Context, db *sql.DB, marketID int64) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(3031)`)
	if err != nil {
		return err
	}

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

	var loaded int
	if err := tx.QueryRowContext(ctx,
		`SELECT count(*) FROM chart_snapshots WHERE chart_date = $1`, chartDate).Scan(&loaded); err != nil {
		return err
	}
	if loaded < ChartSize {
		return ErrChartNotIn
	}

	var rank int64
	err = tx.QueryRowContext(ctx,
		`SELECT rank FROM chart_snapshots WHERE song_id = $1 AND chart_date = $2`, songID, chartDate).Scan(&rank)
	if errors.Is(err, sql.ErrNoRows) {
		rank = ChartSize + 1 // dropped off the chart
	} else if err != nil {
		return err
	}

	outcome := "refund"
	if baseline == 1 && rank == 1 {
		outcome = "yes"
	} else if rank < baseline {
		outcome = "yes"
	} else if rank > baseline {
		outcome = "no"
	}

	type payment struct {
		userID        int64
		side          string
		quantity      int64
		remainingCost int64
	}
	var payments []payment
	rows, err := tx.QueryContext(ctx, `
        SELECT user_id, side, quantity, cost_basis FROM positions
        WHERE market_id = $1 AND (side = $2 OR $2 = 'refund')
        ORDER BY user_id, side
    `, marketID, outcome)
	if err != nil {
		return err
	}
	for rows.Next() {
		var holder payment
		err = rows.Scan(&holder.userID, &holder.side, &holder.quantity, &holder.remainingCost)
		if err != nil {
			rows.Close()
			return err
		}
		payments = append(payments, holder)
	}
	rows.Close()
	if rows.Err() != nil {
		return rows.Err()
	}
	for _, holder := range payments {
		entry := Entry{
			UserID:   holder.userID,
			MarketID: &marketID,
			Side:     holder.side,
			Quantity: holder.quantity,
			Amount:   holder.quantity * ContractPayout,
			Kind:     "payout",
			Price:    ContractPayout,
		}
		if outcome == "refund" {
			entry.Amount = holder.remainingCost
			entry.Kind = "refund"
			entry.Price = 0
		}
		if _, err := Post(ctx, tx, entry); err != nil {
			return err
		}
	}

	_, err = tx.ExecContext(ctx, `UPDATE orders SET cancelled = true WHERE market_id = $1 AND remaining > 0`, marketID)
	if err != nil {
		return err
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

// UserForFirebase returns the ledger user for a Firebase account, creating it
// with the StartingBalance grant on first sign-in. Concurrent first sign-ins
// still create one user and one grant: the loser's insert waits on the unique
// firebase_uid, then finds the winner's row.
func UserForFirebase(ctx context.Context, db *sql.DB, firebaseUID, email string) (int64, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var id int64
	err = tx.QueryRowContext(ctx,
		`INSERT INTO users (firebase_uid, email) VALUES ($1, NULLIF($2, ''))
		 ON CONFLICT (firebase_uid) DO NOTHING
		 RETURNING id`,
		firebaseUID, email).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) { // signed in before
		err = db.QueryRowContext(ctx, `SELECT id FROM users WHERE firebase_uid = $1`, firebaseUID).Scan(&id)
		return id, err
	}
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
