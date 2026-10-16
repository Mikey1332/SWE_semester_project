package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"
)

func testDB(t *testing.T) *sql.DB {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	ctx := context.Background()
	for range 2 { // second run must be a no-op
		if err := Migrate(ctx, db); err != nil {
			t.Fatalf("migrate: %v", err)
		}
	}
	return db
}

func TestLedger(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	name := fmt.Sprintf("user%d", time.Now().UnixNano())
	id, err := CreateUser(ctx, db, name, name+"@example.com", "hash")
	if err != nil {
		t.Fatal(err)
	}

	check := func(wantBalance, wantPnL int64) {
		t.Helper()
		var balance, ledgerSum, pnl int64
		err := db.QueryRowContext(ctx, `
			SELECT b.balance,
			       (SELECT sum(amount) FROM ledger_entries WHERE user_id = $1),
			       (SELECT realized_pnl FROM user_pnl WHERE user_id = $1)
			FROM balances b WHERE b.user_id = $1`, id).Scan(&balance, &ledgerSum, &pnl)
		if err != nil {
			t.Fatal(err)
		}
		if balance != wantBalance || ledgerSum != wantBalance || pnl != wantPnL {
			t.Fatalf("balance=%d ledger=%d pnl=%d, want balance=%d pnl=%d",
				balance, ledgerSum, pnl, wantBalance, wantPnL)
		}
	}

	post := func(amount int64, kind string) error {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		if _, err := Post(ctx, tx, Entry{UserID: id, Amount: amount, Kind: kind}); err != nil {
			return err
		}
		return tx.Commit()
	}

	check(StartingBalance, 0)

	if err := post(-2_500, "trade"); err != nil {
		t.Fatal(err)
	}
	check(7_500, -2_500)

	if err := post(-8_000, "trade"); !errors.Is(err, ErrInsufficientFunds) {
		t.Fatalf("overdraft: got %v, want ErrInsufficientFunds", err)
	}
	check(7_500, -2_500)

	if err := post(500, "grant"); err != nil {
		t.Fatal(err)
	}
	check(8_000, -2_500) // grants never count toward P&L

	if err := post(-1, "grant"); err == nil {
		t.Fatal("negative grant should be rejected")
	}
	check(8_000, -2_500)
}
