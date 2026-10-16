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

const StartingBalance = 10_000

var ErrInsufficientFunds = errors.New("insufficient Music Notes")

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
	Kind     string // grant, trade, or payout
	MarketID *int64
	TradeID  *int64
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
		`INSERT INTO ledger_entries (user_id, amount, balance_after, kind, market_id, trade_id)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		e.UserID, e.Amount, balance, e.Kind, e.MarketID, e.TradeID)
	return balance, err
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
