package main

import (
	"context"
	"errors"
	"testing"
)

func TestValidateOrder(t *testing.T) {
	order := Order{
		UserID:    1,
		MarketID:  1,
		RequestID: "test-order-1",
		Side:      "yes",
		Action:    "buy",
		Price:     50,
		Quantity:  10,
	}

	err := validateOrder(order)
	if err != nil {
		t.Fatal("a valid order was rejected:", err)
	}

	order.Price = 0

	err = validateOrder(order)
	if err == nil {
		t.Fatal("a zero price should be rejected")
	}

	order.Price = 50
	order.Quantity = -1

	err = validateOrder(order)
	if err == nil {
		t.Fatal("a negative quantity should be rejected")
	}
}

func TestPlaceOrder(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()

	marketID, _, _ := newMarket(t, db, 50, 5, 50)
	userID := newUser(t, db)

	order := Order{
		UserID:    userID,
		MarketID:  marketID,
		RequestID: "test-order-1",
		Side:      "yes",
		Action:    "buy",
		Price:     50,
		Quantity:  150,
	}

	saved, err := PlaceOrder(ctx, db, order)
	if err != nil {
		t.Fatal("failed to place order:", err)
	}

	repeated, err := PlaceOrder(ctx, db, order)
	if err != nil {
		t.Fatal("repeating the same request should succeed:", err)
	}
	if repeated.ID != saved.ID {
		t.Fatal("expected the same order ID when placing the same order again, but got a different ID")
	}

	order.RequestID = "test-order-2"
	order.Quantity = 100

	_, err = PlaceOrder(ctx, db, order)
	if !errors.Is(err, ErrInsufficientFunds) {
		t.Fatal("expected an insufficient balance error when placing an order that exceeds the user's balance, but got:", err)
	}

	order.RequestID = "test-order-1"
	order.Price = 60

	_, err = PlaceOrder(ctx, db, order)
	if !errors.Is(err, ErrRequestConflict) {
		t.Fatal("expected a request conflict error when placing an order with the same request ID but different parameters, but got:", err)
	}
	checkUser(t, db, userID, StartingBalance, 0)

	order.RequestID = "sale without contract4"
	order.Action = "sell"

	_, err = PlaceOrder(ctx, db, order)
	if !errors.Is(err, ErrNotEnoughContracts) {
		t.Fatal("expected an error when trying to sell without owning contracts, but got:", err)
	}
}
