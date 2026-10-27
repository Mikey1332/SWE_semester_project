package main

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

var ErrLimitOrder = errors.New("invalid limit order")

var ErrRequestConflict = errors.New("ID already used for a different order")

type Order struct {
	ID        int64  `json:"id"`
	UserID    int64  `json:"user_id"`
	MarketID  int64  `json:"market_id"`
	RequestID string `json:"request_id"`
	Side      string `json:"side"`
	Action    string `json:"action"`
	Price     int64  `json:"price"`
	Quantity  int64  `json:"quantity"`
	Remaining int64  `json:"remaining"`
	Cancelled bool   `json:"cancelled"`
}

func validateOrder(order Order) error {
	if order.UserID <= 0 || order.MarketID <= 0 {
		return ErrLimitOrder
	}

	if order.Side != "yes" && order.Side != "no" {
		return ErrLimitOrder
	}

	if order.Action != "buy" && order.Action != "sell" {
		return ErrLimitOrder
	}

	if order.Price < 1 || order.Price > 99 {
		return ErrLimitOrder
	}

	if order.Quantity < 1 || order.Quantity > 1000000 {
		return ErrLimitOrder
	}

	if strings.TrimSpace(order.RequestID) == "" {
		return ErrLimitOrder
	}

	if len(order.RequestID) > 100 {
		return ErrLimitOrder
	}

	return nil
}

func findOrder(ctx context.Context, tx *sql.Tx, userID int64, requestID string) (Order, error) {
	var order Order
	err := tx.QueryRowContext(ctx, `
		SELECT id, user_id, market_id, request_id,
		       side, action, price, quantity,
		       remaining, cancelled
		FROM orders
		WHERE user_id = $1 AND request_id = $2
	`, userID, requestID).Scan(
		&order.ID, &order.UserID, &order.MarketID, &order.RequestID,
		&order.Side, &order.Action, &order.Price, &order.Quantity,
		&order.Remaining, &order.Cancelled,
	)
	return order, err
}

func PlaceOrder(ctx context.Context, db *sql.DB, order Order) (Order, error) {
	err := validateOrder(order)
	if err != nil {
		return Order{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return Order{}, err
	}
	defer tx.Rollback()
	// orders for identical amrket wait

	var marketID int64

	err = tx.QueryRowContext(ctx, `
	SELECT ID
	FROM markets
	WHERE id = $1
	FOR UPDATE
	`, order.MarketID).Scan(&marketID)

	if errors.Is(err, sql.ErrNoRows) {
		return Order{}, ErrMarketClosed
	}
	if err != nil {
		return Order{}, err
	}

	// ensure funds are protected
	var balance int64

	err = tx.QueryRowContext(ctx, `
	SELECT balance
	FROM balances
	WHERE user_id = $1
	FOR UPDATE
	`, order.UserID).Scan(&balance)

	if err != nil {
		return Order{}, err
	}

	existingOrder, err := findOrder(ctx, tx, order.UserID, order.RequestID)

	if err == nil {
		if existingOrder.MarketID != order.MarketID || existingOrder.Side != order.Side || existingOrder.Action != order.Action || existingOrder.Price != order.Price || existingOrder.Quantity != order.Quantity {
			return Order{}, ErrRequestConflict
		}
		return existingOrder, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Order{}, err
	}

	var open bool

	err = tx.QueryRowContext(ctx, `
	SELECT status = 'open'
	AND clock_timestamp() < closes_at
	FROM markets
	wHERE id = $1
	`, order.MarketID).Scan(&open)

	if err != nil {
		return Order{}, err
	}

	if !open {
		return Order{}, ErrMarketClosed
	}

	if order.Action == "buy" {
		var reserved int64
		err = tx.QueryRowContext(ctx, `
            SELECT COALESCE(SUM(o.price * o.remaining), 0)
            FROM orders o
            JOIN markets m ON m.id = o.market_id
            WHERE o.user_id = $1
              AND o.action = 'buy'
              AND o.remaining > 0
              AND NOT o.cancelled
              AND m.status = 'open'
              AND clock_timestamp() < m.closes_at
        `, order.UserID).Scan(&reserved)
		if err != nil {
			return Order{}, err
		}
		available := balance - reserved
		cost := order.Price * order.Quantity
		if available < cost {
			return Order{}, ErrInsufficientFunds
		}
	} else {
		var owned int64
		var reserved int64
		err = tx.QueryRowContext(ctx, `
            SELECT quantity FROM positions
            WHERE user_id = $1 AND market_id = $2 AND side = $3
            FOR UPDATE
        `, order.UserID, order.MarketID, order.Side).Scan(&owned)
		if errors.Is(err, sql.ErrNoRows) {
			return Order{}, ErrNotEnoughContracts
		}
		if err != nil {
			return Order{}, err
		}
		err = tx.QueryRowContext(ctx, `
            SELECT COALESCE(SUM(remaining), 0)
            FROM orders
            WHERE user_id = $1 AND market_id = $2 AND side = $3
              AND action = 'sell' AND remaining > 0 AND NOT cancelled
        `, order.UserID, order.MarketID, order.Side).Scan(&reserved)
		if err != nil {
			return Order{}, err
		}
		if owned-reserved < order.Quantity {
			return Order{}, ErrNotEnoughContracts
		}
	}

	order.Remaining = order.Quantity
	order.Cancelled = false
	err = tx.QueryRowContext(ctx, `
        INSERT INTO orders (
            user_id, market_id, request_id, side, action,
            price, quantity, remaining, cancelled
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id
    `, order.UserID, order.MarketID, order.RequestID,
		order.Side, order.Action, order.Price, order.Quantity,
		order.Remaining, order.Cancelled).Scan(&order.ID)
	if err != nil {
		return Order{}, err
	}
	err = tx.Commit()
	if err != nil {
		return Order{}, err
	}
	return order, nil
}
