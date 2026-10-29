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
	WeeklyGrant     = 1_000 // Music Notes per weekly claim
	ContractPayout  = 100   // Music Notes paid per winning contract
	ChartSize       = 100   // Billboard Hot 100; a chart with fewer rows is still loading
)

var (
	ErrGrantNotReady      = errors.New("weekly grant already claimed this week")
	ErrInsufficientFunds  = errors.New("insufficient Music Notes")
	ErrInvalidOrder       = errors.New("side must be yes or no and quantity between 1 and 1,000,000")
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

// lockOpenMarket validates an order and returns the price per contract for
// side, locking the market so Resolve waits for in-flight trades (and trades
// wait for Resolve). The market must be open and before closes_at.
func lockOpenMarket(ctx context.Context, tx *sql.Tx, marketID int64, side string, quantity int64) (int64, error) {
	if side != "yes" && side != "no" {
		return 0, ErrInvalidOrder
	}
	if quantity <= 0 || quantity > 1_000_000 { // the cap keeps price*quantity far from overflow
		return 0, ErrInvalidOrder
	}

	var price int64
	var open bool
	err := tx.QueryRowContext(ctx,
		`SELECT yes_price, status = 'open' AND now() < closes_at FROM markets WHERE id = $1 FOR SHARE`,
		marketID).Scan(&price, &open)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !open) {
		return 0, ErrMarketClosed
	}
	if err != nil {
		return 0, err
	}
	if side == "no" {
		price = ContractPayout - price
	}
	return price, nil
}

// Buy sells quantity YES or NO contracts to the user at the bot's price,
// returning the new balance.
func Buy(ctx context.Context, db *sql.DB, userID, marketID int64, side string, quantity int64) (int64, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	price, err := lockOpenMarket(ctx, tx, marketID, side, quantity)
	if err != nil {
		return 0, err
	}
	cost := price * quantity
	balance, err := Post(ctx, tx, Entry{UserID: userID, Amount: -cost, Kind: "buy", MarketID: &marketID,
		Side: side, Quantity: quantity, Price: price})
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

// Sell buys quantity of the user's contracts back at the bot's current price,
// returning the new balance. The sold share of the position's cost basis
// leaves with them, so realized P&L moves by proceeds minus that cost.
func Sell(ctx context.Context, db *sql.DB, userID, marketID int64, side string, quantity int64) (int64, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	price, err := lockOpenMarket(ctx, tx, marketID, side, quantity)
	if err != nil {
		return 0, err
	}
	var held, cost int64
	err = tx.QueryRowContext(ctx,
		`SELECT quantity, cost_basis FROM positions
		 WHERE user_id = $1 AND market_id = $2 AND side = $3 FOR UPDATE`,
		userID, marketID, side).Scan(&held, &cost)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && held < quantity) {
		return 0, ErrNotEnoughContracts
	}
	if err != nil {
		return 0, err
	}

	// Rounds down, so a partial sale never takes the whole cost basis; selling
	// everything takes exactly all of it.
	soldCost := cost * quantity / held
	balance, err := Post(ctx, tx, Entry{UserID: userID, Amount: price * quantity, Kind: "sell", MarketID: &marketID,
		Side: side, Quantity: quantity, Price: price})
	if err != nil {
		return 0, err
	}
	if held == quantity {
		_, err = tx.ExecContext(ctx,
			`DELETE FROM positions WHERE user_id = $1 AND market_id = $2 AND side = $3`,
			userID, marketID, side)
	} else {
		_, err = tx.ExecContext(ctx,
			`UPDATE positions SET quantity = quantity - $4, cost_basis = cost_basis - $5
			 WHERE user_id = $1 AND market_id = $2 AND side = $3`,
			userID, marketID, side, quantity, soldCost)
	}
	if err != nil {
		return 0, err
	}
	return balance, tx.Commit()
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
		`SELECT count(*) FROM chart_snapshots WHERE chart = 'hot-100' AND chart_date = $1`, chartDate).Scan(&loaded); err != nil {
		return err
	}
	if loaded < ChartSize {
		return ErrChartNotIn
	}

	var rank int64
	err = tx.QueryRowContext(ctx,
		`SELECT rank FROM chart_snapshots WHERE chart = 'hot-100' AND song_id = $1 AND chart_date = $2`, songID, chartDate).Scan(&rank)
	if errors.Is(err, sql.ErrNoRows) {
		rank = ChartSize + 1 // dropped off the chart
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
		if _, err := Post(ctx, tx, Entry{UserID: w.userID, Amount: w.quantity * ContractPayout, Kind: "payout", MarketID: &marketID,
			Side: outcome, Quantity: w.quantity, Price: ContractPayout}); err != nil {
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

// ClaimWeeklyGrant credits WeeklyGrant if the user's last grant (the sign-up grant
// counts) is at least 7 days old, returning the new balance.
func ClaimWeeklyGrant(ctx context.Context, db *sql.DB, userID int64) (int64, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	// Lock the balance row so two claims at once can't both pass the check below.
	if _, err := tx.ExecContext(ctx, `SELECT 1 FROM balances WHERE user_id = $1 FOR UPDATE`, userID); err != nil {
		return 0, err
	}
	var recent bool
	if err := tx.QueryRowContext(ctx, `
		SELECT coalesce(max(created_at) > now() - interval '7 days', false)
		FROM ledger_entries WHERE user_id = $1 AND kind = 'grant'`, userID).Scan(&recent); err != nil {
		return 0, err
	}
	if recent {
		return 0, ErrGrantNotReady
	}
	balance, err := Post(ctx, tx, Entry{UserID: userID, Amount: WeeklyGrant, Kind: "grant"})
	if err != nil {
		return 0, err
	}
	return balance, tx.Commit()
}
