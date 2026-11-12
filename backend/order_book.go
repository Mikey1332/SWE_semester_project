package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"sort"
	"strconv"
	"time"
)

type bookLevel struct {
	Price    int64 `json:"price"`
	Quantity int64 `json:"quantity"`
}

type sideBook struct {
	Bids      []bookLevel `json:"bids"`
	Asks      []bookLevel `json:"asks"`
	LastPrice *int64      `json:"last_price"`
}

type orderBook struct {
	Yes sideBook `json:"yes"`
	No  sideBook `json:"no"`
}

func levelsForSide(orders []Order, side string, last Order) sideBook {
	bids := make(map[int64]int64)
	asks := make(map[int64]int64)
	for _, order := range orders {
		action, price := order.quoteForSide(side)
		if action == "buy" {
			bids[price] += order.Remaining
		} else {
			asks[price] += order.Remaining
		}
	}

	book := sideBook{
		Bids: make([]bookLevel, 0, len(bids)),
		Asks: make([]bookLevel, 0, len(asks)),
	}
	for price, quantity := range bids {
		book.Bids = append(book.Bids, bookLevel{Price: price, Quantity: quantity})
	}
	for price, quantity := range asks {
		book.Asks = append(book.Asks, bookLevel{Price: price, Quantity: quantity})
	}
	sort.Slice(book.Bids, func(i, j int) bool { return book.Bids[i].Price > book.Bids[j].Price })
	sort.Slice(book.Asks, func(i, j int) bool { return book.Asks[i].Price < book.Asks[j].Price })
	if last.Price > 0 {
		_, price := last.quoteForSide(side)
		book.LastPrice = &price
	}
	return book
}

func readOrderBook(ctx context.Context, db *sql.DB, marketID int64) (orderBook, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT depth.side, depth.action, depth.price, depth.quantity,
		       COALESCE(latest.side, ''), COALESCE(latest.taker_price, 0)
		FROM markets m
		LEFT JOIN LATERAL (
			SELECT side, action, price, SUM(remaining)::bigint AS quantity
			FROM orders
			WHERE market_id = m.id AND remaining > 0 AND NOT cancelled
			GROUP BY side, action, price
		) depth ON true
		LEFT JOIN LATERAL (
			SELECT o.side, t.taker_price
			FROM trades t JOIN orders o ON o.id = t.taker_id
			WHERE o.market_id = m.id
			ORDER BY t.id DESC LIMIT 1
		) latest ON true
		WHERE m.id = $1 AND m.status = 'open' AND now() < m.closes_at
	`, marketID)
	if err != nil {
		return orderBook{}, err
	}
	defer rows.Close()

	var orders []Order
	var last Order
	found := false
	for rows.Next() {
		found = true
		var side, action sql.NullString
		var price, quantity sql.NullInt64
		if err := rows.Scan(&side, &action, &price, &quantity, &last.Side, &last.Price); err != nil {
			return orderBook{}, err
		}
		if price.Valid {
			orders = append(orders, Order{
				Side: side.String, Action: action.String, Price: price.Int64, Remaining: quantity.Int64,
			})
		}
	}
	if err := rows.Err(); err != nil {
		return orderBook{}, err
	}
	if !found {
		return orderBook{}, sql.ErrNoRows
	}
	return orderBook{
		Yes: levelsForSide(orders, "yes", last),
		No:  levelsForSide(orders, "no", last),
	}, nil
}

func orderBookHandler(w http.ResponseWriter, r *http.Request, db *sql.DB) {
	marketID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || marketID <= 0 {
		http.Error(w, "invalid market ID", http.StatusBadRequest)
		return
	}
	if db == nil {
		http.Error(w, errNoDatabase.Error(), http.StatusServiceUnavailable)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	book, err := readOrderBook(ctx, db, marketID)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		http.Error(w, "market is closed or unavailable", http.StatusNotFound)
	case err != nil:
		log.Printf("order book for market %d: %v", marketID, err)
		http.Error(w, "could not load order book", http.StatusInternalServerError)
	default:
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, book)
	}
}
