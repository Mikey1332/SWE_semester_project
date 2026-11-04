package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"
)

func orderHandler(w http.ResponseWriter, r *http.Request, db *sql.DB) {
	userID, ok := signedIn(w, r)
	if !ok {
		return
	}
	if db == nil {
		http.Error(w, "database not configured", http.StatusServiceUnavailable)
		return
	}
	marketID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || marketID <= 0 {
		http.Error(w, "invalid market ID", http.StatusBadRequest)
		return
	}

	var request struct {
		RequestID string `json:"request_id"`
		Side      string `json:"side"`
		Action    string `json:"action"`
		Price     int64  `json:"price"`
		Quantity  int64  `json:"quantity"`
	}
	body := http.MaxBytesReader(w, r.Body, 2048)
	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	err = decoder.Decode(&request)
	if err != nil {
		http.Error(w, "invalid order JSON", http.StatusBadRequest)
		return
	}
	var extra any
	err = decoder.Decode(&extra)
	if err != io.EOF {
		http.Error(w, "send one JSON object", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	order, err := PlaceOrder(ctx, db, Order{
		UserID:    userID,
		MarketID:  marketID,
		RequestID: request.RequestID,
		Side:      request.Side,
		Action:    request.Action,
		Price:     request.Price,
		Quantity:  request.Quantity,
	})
	if errors.Is(err, ErrLimitOrder) {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if errors.Is(err, ErrRequestConflict) {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	if errors.Is(err, ErrInsufficientFunds) {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	if errors.Is(err, ErrNotEnoughContracts) {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	if errors.Is(err, ErrMarketClosed) {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	if err != nil {
		log.Printf("place order: %v", err)
		http.Error(w, "order failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, order)
}

func listOrders(w http.ResponseWriter, r *http.Request, db *sql.DB) {
	userID, ok := signedIn(w, r)
	if !ok {
		return
	}
	if db == nil {
		http.Error(w, errNoDatabase.Error(), http.StatusServiceUnavailable)
		return
	}
	rows, err := db.QueryContext(r.Context(), `
		SELECT o.id, o.user_id, o.market_id, o.request_id, o.side, o.action,
		       o.price, o.quantity, o.remaining, o.cancelled
		FROM orders o
		JOIN markets m ON m.id = o.market_id
		WHERE o.user_id = $1
		  AND o.remaining > 0
		  AND o.cancelled = false
		  AND m.status = 'open'
		  AND clock_timestamp() < m.closes_at
		ORDER BY o.id DESC`, userID)
	if err != nil {
		log.Printf("list orders: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	orders := []Order{}
	for rows.Next() {
		var order Order
		err = rows.Scan(
			&order.ID,
			&order.UserID,
			&order.MarketID,
			&order.RequestID,
			&order.Side,
			&order.Action,
			&order.Price,
			&order.Quantity,
			&order.Remaining,
			&order.Cancelled,
		)
		if err != nil {
			log.Printf("list orders: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		orders = append(orders, order)
	}
	if rows.Err() != nil {
		log.Printf("list orders: %v", rows.Err())
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, orders)
}

func cancelOrder(w http.ResponseWriter, r *http.Request, db *sql.DB) {
	userID, ok := signedIn(w, r)
	if !ok {
		return
	}
	if db == nil {
		http.Error(w, errNoDatabase.Error(), http.StatusServiceUnavailable)
		return
	}
	orderID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || orderID <= 0 {
		http.Error(w, "invalid order ID", http.StatusBadRequest)
		return
	}
	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(r.Context(), `SELECT pg_advisory_xact_lock(3031)`)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	var id int64
	err = tx.QueryRowContext(r.Context(), `
		UPDATE orders SET cancelled = true
		WHERE id = $1 AND user_id = $2 AND remaining > 0
		RETURNING id`, orderID, userID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "open order not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("cancel order: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	err = tx.Commit()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]int64{"id": id})
}
