package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestProfilePositionsPnLAndWinLoss(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	user := newUser(t, db)
	otherUser := newUser(t, db)

	base := uniqueDate()
	week1 := base.AddDate(0, 0, 7).Format(time.DateOnly)
	week2 := base.AddDate(0, 0, 14).Format(time.DateOnly)
	week3 := base.AddDate(0, 0, 21).Format(time.DateOnly)

	openSong := newSong(t, db)
	var openMarket int64
	err := db.QueryRowContext(ctx, `
		INSERT INTO markets (song_id, chart_date, baseline_rank, shift, yes_price, closes_at)
		VALUES ($1, $2, 15, 1, 65, now() + interval '2 days')
		RETURNING id
	`, openSong, week1).Scan(&openMarket)
	if err != nil {
		t.Fatal(err)
	}

	_, err = PlaceOrder(ctx, db, Order{
		UserID:    otherUser,
		MarketID:  openMarket,
		RequestID: unique("m1-no"),
		Side:      "no",
		Action:    "buy",
		Price:     60,
		Quantity:  10,
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = PlaceOrder(ctx, db, Order{
		UserID:    user,
		MarketID:  openMarket,
		RequestID: unique("m1-yes"),
		Side:      "yes",
		Action:    "buy",
		Price:     40,
		Quantity:  10,
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = PlaceOrder(ctx, db, Order{
		UserID:    user,
		MarketID:  openMarket,
		RequestID: unique("m1-resting"),
		Side:      "yes",
		Action:    "buy",
		Price:     30,
		Quantity:  5,
	})
	if err != nil {
		t.Fatal(err)
	}

	winSong := newSong(t, db)
	var winMarket int64
	err = db.QueryRowContext(ctx, `
		INSERT INTO markets (song_id, chart_date, baseline_rank, shift, yes_price, closes_at)
		VALUES ($1, $2, 20, 1, 60, now() + interval '1 hour')
		RETURNING id
	`, winSong, week2).Scan(&winMarket)
	if err != nil {
		t.Fatal(err)
	}

	_, err = buyForTest(t, ctx, db, user, winMarket, "yes", 10)
	if err != nil {
		t.Fatal(err)
	}
	addRank(t, db, winSong, week2, 10)
	fillChart(t, db, week2)
	err = Resolve(ctx, db, winMarket)
	if err != nil {
		t.Fatal(err)
	}

	loseSong := newSong(t, db)
	var loseMarket int64
	err = db.QueryRowContext(ctx, `
		INSERT INTO markets (song_id, chart_date, baseline_rank, shift, yes_price, closes_at)
		VALUES ($1, $2, 10, 1, 50, now() + interval '1 hour')
		RETURNING id
	`, loseSong, week3).Scan(&loseMarket)
	if err != nil {
		t.Fatal(err)
	}

	_, err = buyForTest(t, ctx, db, user, loseMarket, "yes", 5)
	if err != nil {
		t.Fatal(err)
	}
	addRank(t, db, loseSong, week3, 25)
	fillChart(t, db, week3)
	err = Resolve(ctx, db, loseMarket)
	if err != nil {
		t.Fatal(err)
	}

	oldUser := currentUser
	currentUser = func(*http.Request) (int64, error) {
		return user, nil
	}
	defer func() {
		currentUser = oldUser
	}()

	req := httptest.NewRequest(http.MethodGet, "/me/profile", nil)
	rec := httptest.NewRecorder()
	routes(db).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /me/profile status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var got Profile
	err = json.NewDecoder(rec.Body).Decode(&got)
	if err != nil {
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
