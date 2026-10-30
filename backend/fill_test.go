package main

import (
	"context"
	"testing"
)

func TestFillOrderBuy(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	marketID, _, _ := newMarket(t, db, 50, 5, 50)
	userID := newUser(t, db)
	order, err := PlaceOrder(ctx, db, Order{
		UserID: userID, MarketID: marketID, RequestID: "fill-buy",
		Side: "yes", Action: "buy", Price: 50, Quantity: 10,
	})
	if err != nil {
		t.Fatal(err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	err = fillOrder(ctx, tx, order, 4, 40)
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	checkUser(t, db, userID, StartingBalance, 0)
	var remaining int64
	err = db.QueryRow(`SELECT remaining FROM orders WHERE id = $1`, order.ID).Scan(&remaining)
	if err != nil {
		t.Fatal(err)
	}
	if remaining != 10 {
		t.Fatal("rollback did not restore the order")
	}

	tx, err = db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	err = fillOrder(ctx, tx, order, 4, 40)
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	checkUser(t, db, userID, 9840, 0)
	var quantity, cost int64
	err = db.QueryRow(`SELECT quantity, cost_basis FROM positions WHERE user_id = $1 AND market_id = $2 AND side = 'yes'`, userID, marketID).Scan(&quantity, &cost)
	if err != nil {
		t.Fatal(err)
	}
	if quantity != 4 || cost != 160 {
		t.Fatalf("position quantity=%d cost=%d", quantity, cost)
	}
	err = db.QueryRow(`SELECT remaining FROM orders WHERE id = $1`, order.ID).Scan(&remaining)
	if err != nil {
		t.Fatal(err)
	}
	if remaining != 6 {
		t.Fatalf("remaining=%d, expected 6", remaining)
	}
}

func TestFillOrderSell(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	marketID, _, _ := newMarket(t, db, 50, 5, 50)
	userID := newUser(t, db)
	_, err := buyForTest(t, ctx, db, userID, marketID, "yes", 10)
	if err != nil {
		t.Fatal(err)
	}
	order, err := PlaceOrder(ctx, db, Order{
		UserID: userID, MarketID: marketID, RequestID: "fill-sell",
		Side: "yes", Action: "sell", Price: 60, Quantity: 6,
	})
	if err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	err = fillOrder(ctx, tx, order, 6, 65)
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	checkUser(t, db, userID, 9890, 90)
	var quantity, cost, remaining int64
	err = db.QueryRow(`SELECT p.quantity, p.cost_basis, o.remaining FROM positions p JOIN orders o ON o.id = $3 WHERE p.user_id = $1 AND p.market_id = $2 AND p.side = 'yes'`, userID, marketID, order.ID).Scan(&quantity, &cost, &remaining)
	if err != nil {
		t.Fatal(err)
	}
	if quantity != 4 || cost != 200 || remaining != 0 {
		t.Fatalf("quantity=%d cost=%d remaining=%d", quantity, cost, remaining)
	}
}
