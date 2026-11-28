package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProfilePositionsPnLAndWinLoss(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	user, otherUser := newUser(t, db), newUser(t, db)

	openMarket, _, _ := newMarket(t, db, 15, 1, 65)
	mustOrder(t, db, otherUser, openMarket, "no", "buy", 60, 10)
	mustOrder(t, db, user, openMarket, "yes", "buy", 40, 10)
	mustOrder(t, db, user, openMarket, "yes", "buy", 30, 5)

	winMarket, winSong, week2 := newMarket(t, db, 20, 1, 60)
	if _, err := buyForTest(t, ctx, db, user, winMarket, "yes", 10); err != nil {
		t.Fatal(err)
	}
	addRank(t, db, winSong, week2, 10)
	fillChart(t, db, week2)
	if err := Resolve(ctx, db, winMarket); err != nil {
		t.Fatal(err)
	}

	loseMarket, loseSong, week3 := newMarket(t, db, 10, 1, 50)
	if _, err := buyForTest(t, ctx, db, user, loseMarket, "yes", 5); err != nil {
		t.Fatal(err)
	}
	addRank(t, db, loseSong, week3, 25)
	fillChart(t, db, week3)
	if err := Resolve(ctx, db, loseMarket); err != nil {
		t.Fatal(err)
	}

	signInAs(t, user)
	rec := httptest.NewRecorder()
	routes(db).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/me/profile", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /me/profile status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var got Profile
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Balance != 9750 {
		t.Fatalf("Balance = %d, want 9750", got.Balance)
	}
	if got.ReservedCash != 150 {
		t.Fatalf("ReservedCash = %d, want 150", got.ReservedCash)
	}
	if got.AvailableBalance != 9600 {
		t.Fatalf("AvailableBalance = %d, want 9600", got.AvailableBalance)
	}
	if got.RealizedPnL != 150 {
		t.Fatalf("RealizedPnL = %d, want 150", got.RealizedPnL)
	}
	if got.UnrealizedPnL != 250 {
		t.Fatalf("UnrealizedPnL = %d, want 250", got.UnrealizedPnL)
	}
	if got.Wins != 1 || got.Losses != 1 || got.Refunds != 0 {
		t.Fatalf("record = %dW-%dL-%dR, want 1W-1L-0R", got.Wins, got.Losses, got.Refunds)
	}
	if len(got.ActivePositions) != 1 {
		t.Fatalf("ActivePositions count = %d, want 1", len(got.ActivePositions))
	}
	if len(got.PendingOrders) != 1 || got.PendingOrders[0].Remaining != 5 {
		t.Fatalf("PendingOrders = %+v, want 1 order with 5 remaining", got.PendingOrders)
	}
	if len(got.Resolved) != 2 {
		t.Fatalf("Resolved count = %d, want 2", len(got.Resolved))
	}
}
