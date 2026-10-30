package main

import (
	"context"
	"database/sql"
)

func findMatchingOrder(ctx context.Context, tx *sql.Tx, order Order) (Order, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT id, user_id, market_id, request_id,
		       side, action, price, quantity, remaining, cancelled
		FROM orders
		WHERE market_id = $1 AND user_id <> $2
		  AND remaining > 0 AND cancelled = false
		ORDER BY id ASC
		FOR UPDATE
	`, order.MarketID, order.UserID)

	if err != nil {
		return Order{}, err
	}
	defer rows.Close()

	var bestMatch Order
	var bestPrice int64

	for rows.Next() {
		var otherOrder Order

		err = rows.Scan(
			&otherOrder.ID, &otherOrder.UserID, &otherOrder.MarketID, &otherOrder.RequestID,
			&otherOrder.Side, &otherOrder.Action, &otherOrder.Price, &otherOrder.Quantity,
			&otherOrder.Remaining, &otherOrder.Cancelled,
		)
		if err != nil {
			return Order{}, err
		}

		price := otherOrder.Price

		if otherOrder.Side == order.Side {
			if otherOrder.Action == order.Action {
				continue
			}
		} else {
			if otherOrder.Action != order.Action {
				continue
			}
			price = 100 - otherOrder.Price
		}

		if order.Action == "buy" && price > order.Price {
			continue
		}
		if order.Action == "sell" && price < order.Price {
			continue
		}

		if bestMatch.ID == 0 {
			bestMatch = otherOrder
			bestPrice = price
			continue
		}

		if order.Action == "buy" && price < bestPrice {
			bestMatch = otherOrder
			bestPrice = price
		}
		if order.Action == "sell" && price > bestPrice {
			bestMatch = otherOrder
			bestPrice = price
		}
	}

	if rows.Err() != nil {
		return Order{}, rows.Err()
	}

	if bestMatch.ID == 0 {
		return Order{}, sql.ErrNoRows
	}

	return bestMatch, nil
}

func fillOrder(ctx context.Context, tx *sql.Tx, order Order, quantity int64, price int64) error {
	if quantity <= 0 || quantity > 1000000 {
		return ErrLimitOrder
	}
	if price < 1 || price > 99 {
		return ErrLimitOrder
	}

	if order.Action != "buy" && order.Action != "sell" {
		return ErrLimitOrder
	}

	if order.Side != "yes" && order.Side != "no" {
		return ErrLimitOrder
	}

	if order.Action == "buy" && price > order.Price {
		return ErrLimitOrder
	}

	if order.Action == "sell" && price < order.Price {
		return ErrLimitOrder
	}

	var id int64

	err := tx.QueryRowContext(ctx, `
		UPDATE orders
		SET remaining = remaining - $2
		WHERE id = $1
		  AND remaining >= $2
		  AND cancelled = false
		  AND user_id = $3
		  AND market_id = $4
		  AND side = $5
		  AND action = $6
		  AND price = $7
		RETURNING id
	`,
		order.ID,
		quantity,
		order.UserID,
		order.MarketID,
		order.Side,
		order.Action,
		order.Price,
	).Scan(&id)

	if err != nil {
		return err
	}

	amount := price * quantity

	if order.Action == "buy" {
		amount = -amount
	}

	_, err = Post(ctx, tx, Entry{
		UserID:   order.UserID,
		MarketID: &order.MarketID,
		Kind:     order.Action,
		Amount:   amount,
		Side:     order.Side,
		Quantity: quantity,
		Price:    price,
	})

	if err != nil {
		return err
	}

	if order.Action == "buy" {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO positions (
				user_id, market_id, side, quantity, cost_basis
			)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (user_id, market_id, side)
			DO UPDATE SET
				quantity = positions.quantity + EXCLUDED.quantity,
				cost_basis = positions.cost_basis + EXCLUDED.cost_basis
		`, order.UserID, order.MarketID, order.Side, quantity, price*quantity)

		return err
	}

	var owned int64
	var cost int64

	err = tx.QueryRowContext(ctx, `
		SELECT quantity, cost_basis
		FROM positions
		WHERE user_id = $1 AND market_id = $2 AND side = $3
		FOR UPDATE
	`, order.UserID, order.MarketID, order.Side).Scan(&owned, &cost)

	if err != nil {
		return err
	}

	if owned < quantity {
		return ErrNotEnoughContracts
	}

	if owned == quantity {
		_, err = tx.ExecContext(ctx, `
			DELETE FROM positions
			WHERE user_id = $1 AND market_id = $2 AND side = $3
		`, order.UserID, order.MarketID, order.Side)
	} else {
		soldCost := cost * quantity / owned

		_, err = tx.ExecContext(ctx, `
			UPDATE positions
			SET quantity = quantity - $4,
			    cost_basis = cost_basis - $5
			WHERE user_id = $1 AND market_id = $2 AND side = $3
		`, order.UserID, order.MarketID, order.Side, quantity, soldCost)
	}

	return err
}
