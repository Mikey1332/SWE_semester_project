package main

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

func buyForTest(t *testing.T, ctx context.Context, db *sql.DB, userID, marketID int64, side string, quantity int64) (int64, error) {
	t.Helper()
	order := Order{
		UserID:    userID,
		MarketID:  marketID,
		RequestID: unique("buy"),
		Side:      side,
		Action:    "buy",
		Price:     50,
		Quantity:  quantity,
	}
	if err := validateOrder(order); err != nil {
		return 0, err
	}
	var yesPrice int64
	err := db.QueryRowContext(ctx, `SELECT yes_price FROM markets WHERE id = $1`, marketID).Scan(&yesPrice)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrMarketClosed
	}
	if err != nil {
		return 0, err
	}
	order.Price = yesPrice
	otherSide := "no"
	if side == "no" {
		order.Price = 100 - yesPrice
		otherSide = "yes"
	}
	other := newUser(t, db)
	_, err = PlaceOrder(ctx, db, Order{
		UserID:    other,
		MarketID:  marketID,
		RequestID: unique("fixture"),
		Side:      otherSide,
		Action:    "buy",
		Price:     100 - order.Price,
		Quantity:  quantity,
	})
	if err != nil {
		return 0, err
	}
	result, err := PlaceOrder(ctx, db, order)
	if err != nil {
		return 0, err
	}
	if result.Remaining != 0 {
		return 0, errors.New("fixture order did not fill")
	}
	var balance int64
	err = db.QueryRowContext(ctx, `SELECT balance FROM balances WHERE user_id = $1`, userID).Scan(&balance)
	return balance, err
}

func sellForTest(t *testing.T, ctx context.Context, db *sql.DB, userID, marketID int64, side string, quantity int64) (int64, error) {
	t.Helper()
	order := Order{
		UserID:    userID,
		MarketID:  marketID,
		RequestID: unique("sell"),
		Side:      side,
		Action:    "sell",
		Price:     50,
		Quantity:  quantity,
	}
	if err := validateOrder(order); err != nil {
		return 0, err
	}
	var yesPrice int64
	err := db.QueryRowContext(ctx, `SELECT yes_price FROM markets WHERE id = $1`, marketID).Scan(&yesPrice)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrMarketClosed
	}
	if err != nil {
		return 0, err
	}
	order.Price = yesPrice
	if side == "no" {
		order.Price = 100 - yesPrice
	}
	other := newUser(t, db)
	_, err = PlaceOrder(ctx, db, Order{
		UserID:    other,
		MarketID:  marketID,
		RequestID: unique("fixture"),
		Side:      side,
		Action:    "buy",
		Price:     order.Price,
		Quantity:  quantity,
	})
	if err != nil {
		return 0, err
	}
	result, err := PlaceOrder(ctx, db, order)
	if err != nil {
		return 0, err
	}
	if result.Remaining != 0 {
		return 0, errors.New("fixture order did not fill")
	}
	var balance int64
	err = db.QueryRowContext(ctx, `SELECT balance FROM balances WHERE user_id = $1`, userID).Scan(&balance)
	return balance, err
}
