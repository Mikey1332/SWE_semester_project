package main

import (
	"context"
	"testing"
	"time"
)

func TestSuggest(t *testing.T) {
	for _, c := range []struct {
		ranks        []int
		shift, price int
	}{
		{[]int{30, 25, 20}, 1, 75},
		{[]int{1}, 1, 50},
		{[]int{10, 1}, 1, 50},
		{[]int{10, 2}, 1, 66},
		{[]int{20, 30}, 1, 33},
		{[]int{50, 99}, 1, 33},
		{[]int{40, 45, 30}, 1, 50},
	} {
		shift, price := suggest(c.ranks)
		if shift != c.shift || price != c.price {
			t.Errorf("suggest(%v) = %d, %d; want %d, %d", c.ranks, shift, price, c.shift, c.price)
		}
	}
}

// The bots open next week's markets from a chart, and resolve them once the
// next chart is ingested.
func TestBotsOpenAndResolve(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	base := uniqueDate()
	week := func(n int) string { return base.AddDate(0, 0, 7*n).Format(time.DateOnly) }

	riser, debut := newSong(t, db), newSong(t, db)
	addRank(t, db, riser, week(0), 30)
	addRank(t, db, riser, week(1), 25)
	addRank(t, db, riser, week(2), 20)
	addRank(t, db, debut, week(2), 1)

	for range 2 { // a second run must not open duplicates
		if _, err := CreateMarkets(ctx, db, week(2)); err != nil {
			t.Fatal(err)
		}
	}

	type market struct {
		id                     int64
		baseline, shift, price int
		closesMondayBefore     bool
	}
	markets := map[int64]market{}
	rows, err := db.Query(`
		SELECT song_id, id, baseline_rank, shift, yes_price,
		       closes_at AT TIME ZONE 'America/New_York' = (chart_date - 5)::timestamp
		FROM markets WHERE song_id IN ($1, $2) AND chart_date = $3`, riser, debut, week(3))
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var song int64
		var m market
		if err := rows.Scan(&song, &m.id, &m.baseline, &m.shift, &m.price, &m.closesMondayBefore); err != nil {
			t.Fatal(err)
		}
		markets[song] = m
	}
	rows.Close()

	if len(markets) != 2 {
		t.Fatalf("got %d markets, want one per song", len(markets))
	}
	for song, want := range map[int64]market{
		riser: {markets[riser].id, 20, 1, 75, true},
		debut: {markets[debut].id, 1, 1, 50, true},
	} {
		if markets[song] != want {
			t.Fatalf("song %d market = %+v, want %+v", song, markets[song], want)
		}
	}

	id := newUser(t, db)
	if _, err := buyForTest(t, ctx, db, id, markets[riser].id, "yes", 1); err != nil { // 75
		t.Fatal(err)
	}

	addRank(t, db, riser, week(3), 14) // rose 6; the debut fell off the chart
	if err := botTick(ctx, db); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := db.QueryRow(`SELECT status FROM markets WHERE id = $1`, markets[riser].id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "open" {
		t.Fatalf("market settled on a half-loaded chart (status %q)", status)
	}

	fillChart(t, db, week(3))
	if err := botTick(ctx, db); err != nil {
		t.Fatal(err)
	}

	for _, song := range []int64{riser, debut} {
		var outcome string
		if err := db.QueryRow(`SELECT coalesce(outcome, 'open') FROM markets WHERE id = $1`,
			markets[song].id).Scan(&outcome); err != nil {
			t.Fatal(err)
		}
		want := "yes"
		if song == debut {
			want = "no"
		}
		if outcome != want {
			t.Fatalf("song %d: outcome %q, want %s", song, outcome, want)
		}
	}
	checkUser(t, db, id, 10_025, 25) // paid 75, won 100
}

func TestSuggestPriceBounds(t *testing.T) {
	var falling []int
	for rank := 1; rank <= 100; rank++ {
		falling = append(falling, rank)
	}
	_, price := suggest(falling)
	if price < 1 || price > 99 {
		t.Fatalf("price %d is outside 1 to 99", price)
	}
}
