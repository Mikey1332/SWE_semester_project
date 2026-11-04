package main

import (
	"context"
	"testing"
)

func TestDirectionSettlement(t *testing.T) {
	tests := []struct {
		name    string
		before  int
		after   int
		outcome string
	}{
		{"up", 30, 29, "yes"},
		{"down", 30, 31, "no"},
		{"refund", 30, 30, "refund"},
		{"stay", 1, 1, "yes"},
		{"first falls", 1, 2, "no"},
		{"leaves chart", 100, 101, "no"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := testDB(t)
			ctx := context.Background()
			market, song, date := newMarket(t, db, test.before, 1, 60)
			up := newUser(t, db)
			down := newUser(t, db)
			submitTestOrder(t, db, Order{
				UserID:    up,
				MarketID:  market,
				RequestID: "up",
				Side:      "yes",
				Action:    "buy",
				Price:     60,
				Quantity:  10,
			})
			submitTestOrder(t, db, Order{
				UserID:    down,
				MarketID:  market,
				RequestID: "down",
				Side:      "no",
				Action:    "buy",
				Price:     40,
				Quantity:  10,
			})
			if test.after <= 100 {
				addRank(t, db, song, date, test.after)
			}
			fillChart(t, db, date)
			for i := 0; i < 2; i++ {
				if err := Resolve(ctx, db, market); err != nil {
					t.Fatal(err)
				}
			}
			var outcome string
			if err := db.QueryRow("SELECT outcome FROM markets WHERE id = $1", market).Scan(&outcome); err != nil {
				t.Fatal(err)
			}
			if outcome != test.outcome {
				t.Fatalf("outcome %s; want %s", outcome, test.outcome)
			}
			if outcome == "refund" {
				checkUser(t, db, up, 10000, 0)
				checkUser(t, db, down, 10000, 0)
			} else if outcome == "yes" {
				checkUser(t, db, up, 10400, 400)
				checkUser(t, db, down, 9600, -400)
			} else {
				checkUser(t, db, up, 9400, -600)
				checkUser(t, db, down, 10600, 600)
			}
		})
	}
}

func TestRefundAfterPartialSale(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	market, song, date := newMarket(t, db, 30, 1, 60)
	up := newUser(t, db)
	down := newUser(t, db)
	buyer := newUser(t, db)
	submitTestOrder(t, db, Order{
		UserID:    up,
		MarketID:  market,
		RequestID: "up",
		Side:      "yes",
		Action:    "buy",
		Price:     60,
		Quantity:  10,
	})
	submitTestOrder(t, db, Order{
		UserID:    down,
		MarketID:  market,
		RequestID: "down",
		Side:      "no",
		Action:    "buy",
		Price:     40,
		Quantity:  10,
	})
	submitTestOrder(t, db, Order{
		UserID:    buyer,
		MarketID:  market,
		RequestID: "bid",
		Side:      "yes",
		Action:    "buy",
		Price:     70,
		Quantity:  4,
	})
	submitTestOrder(t, db, Order{
		UserID:    up,
		MarketID:  market,
		RequestID: "sell",
		Side:      "yes",
		Action:    "sell",
		Price:     65,
		Quantity:  4,
	})
	addRank(t, db, song, date, 30)
	fillChart(t, db, date)
	for i := 0; i < 2; i++ {
		if err := Resolve(ctx, db, market); err != nil {
			t.Fatal(err)
		}
	}
	saleProfit := int64(4 * (70 - 60))
	checkUser(t, db, up, StartingBalance+saleProfit, saleProfit)
	checkUser(t, db, down, 10000, 0)
	checkUser(t, db, buyer, 10000, 0)
	var refunds int
	err := db.QueryRow("SELECT count(*) FROM ledger_entries WHERE market_id = $1 AND kind = 'refund'", market).Scan(&refunds)
	if err != nil {
		t.Fatal(err)
	}
	if refunds != 3 {
		t.Fatalf("got %d refunds; want 3", refunds)
	}
}
