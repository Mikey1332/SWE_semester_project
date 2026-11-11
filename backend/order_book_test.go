package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

func TestOrderBookLevels(t *testing.T) {
	orders := []Order{
		{Side: "yes", Action: "buy", Price: 50, Remaining: 2},
		{Side: "no", Action: "sell", Price: 50, Remaining: 4},
		{Side: "yes", Action: "buy", Price: 49, Remaining: 1},
		{Side: "yes", Action: "sell", Price: 70, Remaining: 3},
		{Side: "no", Action: "buy", Price: 40, Remaining: 8},
	}
	last := Order{Side: "no", Action: "buy", Price: 41}
	checkBook(t, levelsForSide(orders, "yes", last),
		[]bookLevel{{50, 6}, {49, 1}}, []bookLevel{{60, 8}, {70, 3}}, 59)
	checkBook(t, levelsForSide(orders, "no", last),
		[]bookLevel{{40, 8}, {30, 3}}, []bookLevel{{50, 6}, {51, 1}}, 41)
}

func checkBook(t *testing.T, book sideBook, bids, asks []bookLevel, last int64) {
	t.Helper()
	if !slices.Equal(book.Bids, bids) || !slices.Equal(book.Asks, asks) {
		t.Fatalf("book has bids %v and asks %v, want %v and %v", book.Bids, book.Asks, bids, asks)
	}
	if book.LastPrice == nil || *book.LastPrice != last {
		t.Fatalf("want last trade price %d, got %v", last, book.LastPrice)
	}
}

func TestOrderBookHTTP(t *testing.T) {
	db := testDB(t)
	marketID, _, _ := newMarket(t, db, 50, 5, 50)
	otherMarket, _, _ := newMarket(t, db, 50, 5, 50)
	user := newUser(t, db)
	insert := func(market int64, side string, price, remaining int64, cancelled bool) int64 {
		t.Helper()
		var id int64
		err := db.QueryRow(`
			INSERT INTO orders (user_id, market_id, request_id, side, action, price, quantity, remaining, cancelled)
			VALUES ($1, $2, $3, $4, 'buy', $5, 10, $6, $7) RETURNING id
		`, user, market, unique("book"), side, price, remaining, cancelled).Scan(&id)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	maker := insert(marketID, "yes", 59, 3, false)
	taker := insert(marketID, "no", 41, 0, false)
	insert(marketID, "no", 40, 4, false)
	insert(marketID, "yes", 70, 5, true)
	insert(otherMarket, "yes", 80, 6, false)
	if _, err := db.Exec(`
		INSERT INTO trades (maker_id, taker_id, quantity, maker_price, taker_price)
		VALUES ($1, $2, 7, 59, 41)
	`, maker, taker); err != nil {
		t.Fatal(err)
	}

	handler := routes(db)
	get := func(market int64) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/markets/%d/orderbook", market), nil))
		return response
	}
	response := get(marketID)
	if response.Code != http.StatusOK {
		t.Fatalf("order book: %d %s", response.Code, response.Body)
	}
	var book orderBook
	if err := json.Unmarshal(response.Body.Bytes(), &book); err != nil {
		t.Fatal(err)
	}
	checkBook(t, book.Yes, []bookLevel{{59, 3}}, []bookLevel{{60, 4}}, 59)
	checkBook(t, book.No, []bookLevel{{40, 4}}, []bookLevel{{41, 3}}, 41)

	if _, err := db.Exec("UPDATE markets SET closes_at = now() WHERE id = $1", marketID); err != nil {
		t.Fatal(err)
	}
	if response := get(marketID); response.Code != http.StatusNotFound {
		t.Fatalf("closed order book: %d %s", response.Code, response.Body)
	}
}
