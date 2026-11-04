package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOrderHTTP(t *testing.T) {
	db := testDB(t)
	marketID, _, _ := newMarket(t, db, 50, 5, 50)
	userID := newUser(t, db)
	otherID := newUser(t, db)
	signInAs(t, userID)
	path := fmt.Sprintf("/markets/%d/orders", marketID)
	body := `{"request_id":"request-1","side":"yes","action":"buy","price":50,"quantity":10}`
	response := httptest.NewRecorder()
	routes(db).ServeHTTP(response, httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)))
	if response.Code != http.StatusOK {
		t.Fatalf("place: %d %s", response.Code, response.Body)
	}
	var order Order
	if err := json.Unmarshal(response.Body.Bytes(), &order); err != nil {
		t.Fatal(err)
	}
	if order.UserID != userID || order.Remaining != 10 {
		t.Fatal("wrong order")
	}
	response = httptest.NewRecorder()
	routes(db).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/me/orders", nil))
	var orders []Order
	if err := json.Unmarshal(response.Body.Bytes(), &orders); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || len(orders) != 1 || orders[0].ID != order.ID {
		t.Fatal("order not listed")
	}
	signInAs(t, otherID)
	response = httptest.NewRecorder()
	cancelPath := fmt.Sprintf("/orders/%d/cancel", order.ID)
	routes(db).ServeHTTP(response, httptest.NewRequest(http.MethodPost, cancelPath, nil))
	if response.Code != http.StatusNotFound {
		t.Fatal("another user cancelled the order")
	}
	signInAs(t, userID)
	response = httptest.NewRecorder()
	routes(db).ServeHTTP(response, httptest.NewRequest(http.MethodPost, cancelPath, nil))
	if response.Code != http.StatusOK {
		t.Fatalf("cancel: %d %s", response.Code, response.Body)
	}
	response = httptest.NewRecorder()
	routes(db).ServeHTTP(response, httptest.NewRequest(http.MethodPost, cancelPath, nil))
	if response.Code != http.StatusOK {
		t.Fatal("repeated cancellation should succeed")
	}
	response = httptest.NewRecorder()
	routes(db).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/me/orders", nil))
	if err := json.Unmarshal(response.Body.Bytes(), &orders); err != nil {
		t.Fatal(err)
	}
	if len(orders) != 0 {
		t.Fatal("cancelled order still listed")
	}
	checkUser(t, db, userID, StartingBalance, 0)
}

func postOrder(t *testing.T, db *sql.DB, path string, body string) Order {
	t.Helper()
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	routes(db).ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("place: %d %s", response.Code, response.Body)
	}
	var order Order
	err := json.Unmarshal(response.Body.Bytes(), &order)
	if err != nil {
		t.Fatal(err)
	}
	return order
}

func TestOrderHTTPMatching(t *testing.T) {
	db := testDB(t)
	marketID, _, _ := newMarket(t, db, 50, 5, 50)
	yesID := newUser(t, db)
	noID := newUser(t, db)
	buyerID := newUser(t, db)
	path := fmt.Sprintf("/markets/%d/orders", marketID)

	signInAs(t, yesID)
	yesBody := `{"request_id":"yes","side":"yes","action":"buy","price":60,"quantity":5}`
	yes := postOrder(t, db, path, yesBody)
	if yes.Remaining != 5 {
		t.Fatal("unmatched order should wait")
	}
	signInAs(t, noID)
	noBody := `{"request_id":"no","side":"no","action":"buy","price":45,"quantity":3}`
	no := postOrder(t, db, path, noBody)
	if no.Remaining != 0 {
		t.Fatal("complementary order did not fill")
	}
	again := postOrder(t, db, path, noBody)
	if again.ID != no.ID {
		t.Fatal("retry created duplicate")
	}
	checkUser(t, db, yesID, 9820, 0)
	checkUser(t, db, noID, 9880, 0)
	signInAs(t, buyerID)
	postOrder(t, db, path, `{"request_id":"bid","side":"yes","action":"buy","price":70,"quantity":2}`)
	signInAs(t, yesID)
	sale := postOrder(t, db, path, `{"request_id":"sale","side":"yes","action":"sell","price":65,"quantity":2}`)
	if sale.Remaining != 0 {
		t.Fatal("sale did not fill")
	}
	checkUser(t, db, yesID, 9960, 20)
	checkUser(t, db, buyerID, 9860, 0)
	var trades int
	if err := db.QueryRow(`SELECT count(*) FROM trades t JOIN orders o ON o.id = t.taker_id WHERE o.market_id = $1`, marketID).Scan(&trades); err != nil {
		t.Fatal(err)
	}
	if trades != 2 {
		t.Fatalf("got %d trades, expected 2", trades)
	}
}
