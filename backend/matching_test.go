package main

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

func TestFindMatchingOrder(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	marketID, _, _ := newMarket(t, db, 50, 5, 50)
	makerID := newUser(t, db)
	buyerID := newUser(t, db)

	pending := Order{
		UserID: makerID, MarketID: marketID,
		RequestID: "older-expensive", Side: "no", Action: "buy",
		Price: 40, Quantity: 10,
	}
	_, err := PlaceOrder(ctx, db, pending)
	if err != nil {
		t.Fatal(err)
	}

	pending.RequestID = "first-cheap"
	pending.Price = 45
	first, err := PlaceOrder(ctx, db, pending)
	if err != nil {
		t.Fatal(err)
	}

	pending.RequestID = "second-cheap"
	second, err := PlaceOrder(ctx, db, pending)
	if err != nil {
		t.Fatal(err)
	}

	pending.UserID = buyerID
	pending.RequestID = "own-order"
	pending.Price = 50
	_, err = PlaceOrder(ctx, db, pending)
	if err != nil {
		t.Fatal(err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	incoming := Order{UserID: buyerID, MarketID: marketID,
		Side: "yes", Action: "buy", Price: 60}
	match, err := findMatchingOrder(ctx, tx, incoming)
	if err != nil {
		t.Fatal(err)
	}
	if match.ID != first.ID {
		t.Fatal("did not select the best price and oldest equal-price order")
	}

	_, err = tx.ExecContext(ctx, "UPDATE orders SET cancelled = true WHERE id = $1", first.ID)
	if err != nil {
		t.Fatal(err)
	}
	match, err = findMatchingOrder(ctx, tx, incoming)
	if err != nil {
		t.Fatal(err)
	}
	if match.ID != second.ID {
		t.Fatal("selected a cancelled order")
	}

	incoming.Price = 54
	_, err = findMatchingOrder(ctx, tx, incoming)
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("expected no affordable match, got %v", err)
	}
}

