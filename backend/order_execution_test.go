package main

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"
)

func TestLimitSettlementRace(t *testing.T) {
	db := testDB(t)
	market, song, date := newMarket(t, db, 50, 5, 50)
	yes := newUser(t, db)
	no := newUser(t, db)
	submitTestOrder(t, db, Order{
		UserID:    yes,
		MarketID:  market,
		RequestID: "seed-yes",
		Side:      "yes",
		Action:    "buy",
		Price:     50,
		Quantity:  10,
	})
	submitTestOrder(t, db, Order{
		UserID:    no,
		MarketID:  market,
		RequestID: "seed-no",
		Side:      "no",
		Action:    "buy",
		Price:     50,
		Quantity:  10,
	})
	buyer := newUser(t, db)
	submitTestOrder(t, db, Order{
		UserID:    buyer,
		MarketID:  market,
		RequestID: "bid",
		Side:      "yes",
		Action:    "buy",
		Price:     60,
		Quantity:  10,
	})
	addRank(t, db, song, date, 40)
	fillChart(t, db, date)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	start := make(chan struct{})
	saleResult := make(chan error, 1)
	settleResult := make(chan error, 1)
	go func() {
		<-start
		_, err := PlaceOrder(ctx, db, Order{
			UserID:    yes,
			MarketID:  market,
			RequestID: "sell",
			Side:      "yes",
			Action:    "sell",
			Price:     60,
			Quantity:  10,
		})
		saleResult <- err
	}()
	go func() {
		<-start
		settleResult <- Resolve(ctx, db, market)
	}()
	close(start)
	saleError := <-saleResult
	if err := <-settleResult; err != nil {
		t.Fatal(err)
	}
	if saleError == nil {
		checkUser(t, db, yes, 10100, 100)
		checkUser(t, db, buyer, 10400, 400)
	} else if errors.Is(saleError, ErrMarketClosed) {
		checkUser(t, db, yes, 10500, 500)
		checkUser(t, db, buyer, StartingBalance, 0)
	} else {
		t.Fatal(saleError)
	}
	var activeOrders, positions int
	err := db.QueryRow(`SELECT
        (SELECT count(*) FROM orders WHERE market_id = $1 AND remaining > 0 AND NOT cancelled),
        (SELECT count(*) FROM positions WHERE market_id = $1)`, market).Scan(&activeOrders, &positions)
	if err != nil {
		t.Fatal(err)
	}
	if activeOrders != 0 || positions != 0 {
		t.Fatal("settlement left orders or positions active")
	}
}

func submitTestOrder(t *testing.T, db *sql.DB, order Order) Order {
	t.Helper()
	result, err := PlaceOrder(context.Background(), db, order)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestLimitComplementaryAndRetry(t *testing.T) {
	db := testDB(t)
	market, _, _ := newMarket(t, db, 50, 5, 50)
	yesUser := newUser(t, db)
	noUser := newUser(t, db)
	yes := Order{
		UserID:    yesUser,
		MarketID:  market,
		RequestID: "yes-1",
		Side:      "yes",
		Action:    "buy",
		Price:     60,
		Quantity:  10,
	}
	first := submitTestOrder(t, db, yes)
	if first.Remaining != 10 {
		t.Fatal("unmatched order should remain open")
	}
	no := submitTestOrder(t, db, Order{
		UserID:    noUser,
		MarketID:  market,
		RequestID: "no-1",
		Side:      "no",
		Action:    "buy",
		Price:     45,
		Quantity:  4,
	})
	if no.Remaining != 0 {
		t.Fatal("complementary order did not fill")
	}
	checkUser(t, db, yesUser, 9760, 0)
	checkUser(t, db, noUser, 9840, 0)
	again := submitTestOrder(t, db, yes)
	if again.ID != first.ID || again.Remaining != 6 {
		t.Fatal("retry created another order or lost the partial fill")
	}
	yes.Price = 61
	_, err := PlaceOrder(context.Background(), db, yes)
	if !errors.Is(err, ErrRequestConflict) {
		t.Fatalf("changed retry: %v", err)
	}
}

func TestLimitPriceTimeAndPartialFills(t *testing.T) {
	db := testDB(t)
	market, _, _ := newMarket(t, db, 50, 5, 50)
	seller := newUser(t, db)
	other := newUser(t, db)
	buyer := newUser(t, db)
	submitTestOrder(t, db, Order{
		UserID:    seller,
		MarketID:  market,
		RequestID: "seed-yes",
		Side:      "yes",
		Action:    "buy",
		Price:     50,
		Quantity:  20,
	})
	submitTestOrder(t, db, Order{
		UserID:    other,
		MarketID:  market,
		RequestID: "seed-no",
		Side:      "no",
		Action:    "buy",
		Price:     50,
		Quantity:  20,
	})
	expensive := submitTestOrder(t, db, Order{
		UserID:    seller,
		MarketID:  market,
		RequestID: "expensive",
		Side:      "yes",
		Action:    "sell",
		Price:     60,
		Quantity:  8,
	})
	cheap := submitTestOrder(t, db, Order{
		UserID:    seller,
		MarketID:  market,
		RequestID: "cheap",
		Side:      "yes",
		Action:    "sell",
		Price:     55,
		Quantity:  4,
	})
	later := submitTestOrder(t, db, Order{
		UserID:    seller,
		MarketID:  market,
		RequestID: "later",
		Side:      "yes",
		Action:    "sell",
		Price:     55,
		Quantity:  4,
	})
	bought := submitTestOrder(t, db, Order{
		UserID:    buyer,
		MarketID:  market,
		RequestID: "take",
		Side:      "yes",
		Action:    "buy",
		Price:     60,
		Quantity:  11,
	})
	rows, err := db.Query(`SELECT maker_id, quantity FROM trades WHERE taker_id = $1 ORDER BY id`, bought.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	wantIDs := []int64{cheap.ID, later.ID, expensive.ID}
	wantQuantities := []int64{4, 4, 3}
	index := 0
	for rows.Next() {
		var id, quantity int64
		err = rows.Scan(&id, &quantity)
		if err != nil {
			t.Fatal(err)
		}
		if index >= len(wantIDs) || id != wantIDs[index] || quantity != wantQuantities[index] {
			t.Fatal("wrong price-time priority or fill quantity")
		}
		index++
	}
	if rows.Err() != nil {
		t.Fatal(rows.Err())
	}
	if index != 3 || bought.Remaining != 0 {
		t.Fatal("missing fills")
	}
	checkUser(t, db, buyer, 9380, 0)
	checkUser(t, db, seller, 9620, 70)
}

func TestLimitConcurrentReservations(t *testing.T) {
	db := testDB(t)
	market, _, _ := newMarket(t, db, 50, 5, 50)
	user := newUser(t, db)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	start := make(chan struct{})
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		order := Order{
			UserID:    user,
			MarketID:  market,
			RequestID: unique("request"),
			Side:      "yes",
			Action:    "buy",
			Price:     50,
			Quantity:  150,
		}
		go func(order Order) {
			<-start
			_, err := PlaceOrder(ctx, db, order)
			results <- err
		}(order)
	}
	close(start)
	successes := 0
	refusals := 0
	for i := 0; i < 2; i++ {
		err := <-results
		if err == nil {
			successes++
		} else if errors.Is(err, ErrInsufficientFunds) {
			refusals++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || refusals != 1 {
		t.Fatal("reserved the same money twice")
	}
	checkUser(t, db, user, StartingBalance, 0)
}

func TestLimitConcurrentSales(t *testing.T) {
	db := testDB(t)
	market, _, _ := newMarket(t, db, 50, 5, 50)
	seller := newUser(t, db)
	other := newUser(t, db)
	buyer := newUser(t, db)
	submitTestOrder(t, db, Order{
		UserID:    seller,
		MarketID:  market,
		RequestID: "seed-yes",
		Side:      "yes",
		Action:    "buy",
		Price:     50,
		Quantity:  10,
	})
	submitTestOrder(t, db, Order{
		UserID:    other,
		MarketID:  market,
		RequestID: "seed-no",
		Side:      "no",
		Action:    "buy",
		Price:     50,
		Quantity:  10,
	})
	submitTestOrder(t, db, Order{
		UserID:    buyer,
		MarketID:  market,
		RequestID: "bid",
		Side:      "yes",
		Action:    "buy",
		Price:     60,
		Quantity:  10,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	start := make(chan struct{})
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		order := Order{
			UserID:    seller,
			MarketID:  market,
			RequestID: unique("sell"),
			Side:      "yes",
			Action:    "sell",
			Price:     60,
			Quantity:  6,
		}
		go func(order Order) {
			<-start
			_, err := PlaceOrder(ctx, db, order)
			results <- err
		}(order)
	}
	close(start)
	successes := 0
	refusals := 0
	for i := 0; i < 2; i++ {
		err := <-results
		if err == nil {
			successes++
		} else if errors.Is(err, ErrNotEnoughContracts) {
			refusals++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || refusals != 1 {
		t.Fatal("sold contracts twice")
	}
	checkUser(t, db, seller, 9860, 60)
	checkUser(t, db, buyer, 9640, 0)
}

func TestLimitComplementarySales(t *testing.T) {
	db := testDB(t)
	market, _, _ := newMarket(t, db, 50, 5, 50)
	yes := newUser(t, db)
	no := newUser(t, db)
	submitTestOrder(t, db, Order{
		UserID:    yes,
		MarketID:  market,
		RequestID: "yes-buy",
		Side:      "yes",
		Action:    "buy",
		Price:     50,
		Quantity:  10,
	})
	submitTestOrder(t, db, Order{
		UserID:    no,
		MarketID:  market,
		RequestID: "no-buy",
		Side:      "no",
		Action:    "buy",
		Price:     50,
		Quantity:  10,
	})
	submitTestOrder(t, db, Order{
		UserID:    yes,
		MarketID:  market,
		RequestID: "yes-sell",
		Side:      "yes",
		Action:    "sell",
		Price:     60,
		Quantity:  10,
	})
	result := submitTestOrder(t, db, Order{
		UserID:    no,
		MarketID:  market,
		RequestID: "no-sell",
		Side:      "no",
		Action:    "sell",
		Price:     35,
		Quantity:  10,
	})
	if result.Remaining != 0 {
		t.Fatal("complementary sales did not fill")
	}
	checkUser(t, db, yes, 10100, 100)
	checkUser(t, db, no, 9900, -100)
}
