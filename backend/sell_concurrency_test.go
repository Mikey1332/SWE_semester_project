package main

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestConcurrentSells(t *testing.T) {
	db := testDB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	marketID, _, _ := newMarket(t, db, 50, 5, 50)
	userID := newUser(t, db)
	// first i buy 10 contracts of yes
	_, err := Buy(ctx, db, userID, marketID, "yes", 10)
	if err != nil {
		t.Fatal(err)
	}
	// Then i try to sell the same 10 yes contracts twice at the same time.
	start := make(chan struct{})
	results := make(chan error, 2)

	for i := 0; i < 2; i++ {
		go func() {
			<-start

			_, sellError := Sell(ctx, db, userID, marketID, "yes", 10)
			results <- sellError
		}()
	}
	close(start)

	successCount := 0
	refusalCount := 0

	for i := 0; i < 2; i++ {
		sellError := <-results
		if sellError == nil {
			successCount++
		} else if errors.Is(sellError, ErrNotEnoughContracts) {
			refusalCount++
		} else {
			t.Errorf("unexpected sell error: %v", sellError)
		}
	}

	if successCount != 1 || refusalCount != 1 {
		t.Fatalf("expected 1 success and 1 refusal, got %d success and %d refusal", successCount, refusalCount)
	}
	checkUser(t, db, userID, StartingBalance, 0)
	var positions int
	var sales int
	err = db.QueryRowContext(ctx, `
		SELECT
		    (SELECT count(*) FROM positions WHERE user_id = $1),
		    (SELECT count(*) FROM ledger_entries
		     WHERE user_id = $1 AND kind = 'sell')
	`, userID).Scan(&positions, &sales)
	if err != nil {
		t.Fatal(err)
	}
	if positions != 0 || sales != 1 {
		t.Fatalf("expected 0 positions and 1 sale, got %d positions and %d sales", positions, sales)
	}
}
