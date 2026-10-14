package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func testDB(t *testing.T) *sql.DB {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	ctx := context.Background()
	for range 2 { // second run must be a no-op
		if err := Migrate(ctx, db); err != nil {
			t.Fatalf("migrate: %v", err)
		}
	}
	return db
}

// unique returns a name no other test run has used.
func unique(prefix string) string {
	return fmt.Sprintf("%s%d", prefix, time.Now().UnixNano())
}

func newUser(t *testing.T, db *sql.DB) int64 {
	t.Helper()
	name := unique("user")
	id, err := CreateUser(context.Background(), db, name, name+"@example.com", "hash")
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestLedger(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	id := newUser(t, db)

	check := func(wantBalance, wantPnL int64) {
		t.Helper()
		var balance, ledgerSum, pnl int64
		err := db.QueryRowContext(ctx, `
			SELECT b.balance,
			       (SELECT sum(amount) FROM ledger_entries WHERE user_id = $1),
			       (SELECT realized_pnl FROM user_pnl WHERE user_id = $1)
			FROM balances b WHERE b.user_id = $1`, id).Scan(&balance, &ledgerSum, &pnl)
		if err != nil {
			t.Fatal(err)
		}
		if balance != wantBalance || ledgerSum != wantBalance || pnl != wantPnL {
			t.Fatalf("balance=%d ledger=%d pnl=%d, want balance=%d pnl=%d",
				balance, ledgerSum, pnl, wantBalance, wantPnL)
		}
	}

	post := func(amount int64, kind string) error {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		if _, err := Post(ctx, tx, Entry{UserID: id, Amount: amount, Kind: kind}); err != nil {
			return err
		}
		return tx.Commit()
	}

	check(StartingBalance, 0)

	if err := post(-2_500, "buy"); err != nil {
		t.Fatal(err)
	}
	check(7_500, -2_500)

	if err := post(-8_000, "buy"); !errors.Is(err, ErrInsufficientFunds) {
		t.Fatalf("overdraft: got %v, want ErrInsufficientFunds", err)
	}
	check(7_500, -2_500)

	if err := post(500, "grant"); err != nil {
		t.Fatal(err)
	}
	check(8_000, -2_500) // grants never count toward P&L

	if err := post(-1, "grant"); err == nil {
		t.Fatal("negative grant should be rejected")
	}
	check(8_000, -2_500)

	res := httptest.NewRecorder()
	routes(db).ServeHTTP(res, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/users/%d/balance", id), nil))
	if want := `{"balance":8000,"realized_pnl":-2500}`; strings.TrimSpace(res.Body.String()) != want {
		t.Fatalf("GET balance: %d %s, want %s", res.Code, res.Body, want)
	}

	for path, want := range map[string]int{
		"/users/0/balance":   http.StatusNotFound,
		"/users/abc/balance": http.StatusBadRequest,
	} {
		res = httptest.NewRecorder()
		routes(db).ServeHTTP(res, httptest.NewRequest(http.MethodGet, path, nil))
		if res.Code != want {
			t.Fatalf("GET %s: got %d, want %d", path, res.Code, want)
		}
	}
}

// A Post whose transaction rolls back must leave no trace.
func TestPostRollback(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	id := newUser(t, db)

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Post(ctx, tx, Entry{UserID: id, Amount: -1_000, Kind: "buy"}); err != nil {
		t.Fatal(err)
	}
	tx.Rollback()

	var balance, entries int64
	err = db.QueryRowContext(ctx, `
		SELECT b.balance, (SELECT count(*) FROM ledger_entries WHERE user_id = $1)
		FROM balances b WHERE b.user_id = $1`, id).Scan(&balance, &entries)
	if err != nil {
		t.Fatal(err)
	}
	if balance != StartingBalance || entries != 1 {
		t.Fatalf("balance=%d entries=%d, want %d and 1 (the grant)", balance, entries, StartingBalance)
	}
}

// Concurrent debits must never spend the same notes twice.
func TestConcurrentDebits(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	id := newUser(t, db)

	const workers, debit = 20, 1_000 // twice what the balance can cover
	var ok, refused atomic.Int64
	var wg sync.WaitGroup
	for range workers {
		wg.Go(func() {
			tx, err := db.BeginTx(ctx, nil)
			if err != nil {
				t.Error(err)
				return
			}
			defer tx.Rollback()
			_, err = Post(ctx, tx, Entry{UserID: id, Amount: -debit, Kind: "buy"})
			if errors.Is(err, ErrInsufficientFunds) {
				refused.Add(1)
				return
			}
			if err == nil {
				err = tx.Commit()
			}
			if err != nil {
				t.Error(err)
				return
			}
			ok.Add(1)
		})
	}
	wg.Wait()

	var balance, ledgerSum int64
	err := db.QueryRowContext(ctx, `
		SELECT b.balance, (SELECT sum(amount) FROM ledger_entries WHERE user_id = $1)
		FROM balances b WHERE b.user_id = $1`, id).Scan(&balance, &ledgerSum)
	if err != nil {
		t.Fatal(err)
	}
	if ok.Load() != StartingBalance/debit || refused.Load() != workers-StartingBalance/debit || balance != 0 || ledgerSum != 0 {
		t.Fatalf("ok=%d refused=%d balance=%d ledger=%d, want ok=%d refused=%d balance=0 ledger=0",
			ok.Load(), refused.Load(), balance, ledgerSum, StartingBalance/debit, workers-StartingBalance/debit)
	}
}

// uniqueDate returns a far-future chart date no other test run uses, so
// chart_snapshots rows from earlier runs never collide or leak in.
func uniqueDate() time.Time {
	offset := int(time.Now().UnixNano() / 1_000 % 1_000_000)
	return time.Date(3000, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, offset)
}

func newSong(t *testing.T, db *sql.DB) int64 {
	t.Helper()
	var id int64
	if err := db.QueryRow(`INSERT INTO songs (title, artist) VALUES ($1, 'Test Artist') RETURNING id`,
		unique("song")).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// newMarket creates a song and a market on a unique chart date that is open for a day.
func newMarket(t *testing.T, db *sql.DB, baseline, shift, yesPrice int) (marketID, songID int64, chartDate string) {
	t.Helper()
	songID, chartDate = newSong(t, db), uniqueDate().Format(time.DateOnly)
	err := db.QueryRow(`
		INSERT INTO markets (song_id, chart_date, baseline_rank, shift, yes_price, closes_at)
		VALUES ($1, $2, $3, $4, $5, now() + interval '1 day') RETURNING id`,
		songID, chartDate, baseline, shift, yesPrice).Scan(&marketID)
	if err != nil {
		t.Fatal(err)
	}
	return marketID, songID, chartDate
}

func addRank(t *testing.T, db *sql.DB, songID int64, chartDate string, rank int) {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO chart_snapshots (song_id, chart_date, rank) VALUES ($1, $2, $3)`,
		songID, chartDate, rank); err != nil {
		t.Fatal(err)
	}
}

func checkUser(t *testing.T, db *sql.DB, userID, wantBalance, wantPnL int64) {
	t.Helper()
	var balance, pnl int64
	err := db.QueryRow(`
		SELECT b.balance, p.realized_pnl FROM balances b JOIN user_pnl p USING (user_id)
		WHERE b.user_id = $1`, userID).Scan(&balance, &pnl)
	if err != nil {
		t.Fatal(err)
	}
	if balance != wantBalance || pnl != wantPnL {
		t.Fatalf("user %d: balance=%d pnl=%d, want balance=%d pnl=%d", userID, balance, pnl, wantBalance, wantPnL)
	}
}

func TestBuyAndResolve(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	marketID, songID, chartDate := newMarket(t, db, 50, 5, 62) // YES = rises 5+ spots from #50
	yes, no := newUser(t, db), newUser(t, db)

	if _, err := Buy(ctx, db, yes, marketID, "yes", 10); err != nil { // 10 x 62
		t.Fatal(err)
	}
	if _, err := Buy(ctx, db, no, marketID, "no", 10); err != nil { // 10 x (100 - 62)
		t.Fatal(err)
	}
	checkUser(t, db, yes, 9_380, 0) // open positions are not losses yet
	checkUser(t, db, no, 9_620, 0)

	if err := Resolve(ctx, db, marketID); !errors.Is(err, ErrChartNotIn) {
		t.Fatalf("resolve before chart: got %v, want ErrChartNotIn", err)
	}

	addRank(t, db, songID, chartDate, 44) // rose 6 spots
	for range 2 {                         // second Resolve must not pay twice
		if err := Resolve(ctx, db, marketID); err != nil {
			t.Fatal(err)
		}
	}
	checkUser(t, db, yes, 10_380, 380)
	checkUser(t, db, no, 9_620, -380)

	var open int
	if err := db.QueryRow(`SELECT count(*) FROM positions WHERE market_id = $1`, marketID).Scan(&open); err != nil {
		t.Fatal(err)
	}
	if open != 0 {
		t.Fatalf("%d positions left open after resolution", open)
	}
	if _, err := Buy(ctx, db, yes, marketID, "yes", 1); !errors.Is(err, ErrMarketClosed) {
		t.Fatalf("buy after resolution: got %v, want ErrMarketClosed", err)
	}
}

// A song missing from an ingested chart counts as rank 101.
func TestResolveOffChart(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	marketID, _, chartDate := newMarket(t, db, 10, -20, 30) // YES = falls 20+ spots from #10
	id := newUser(t, db)

	if _, err := Buy(ctx, db, id, marketID, "yes", 5); err != nil { // 5 x 30
		t.Fatal(err)
	}
	_, otherSong, _ := newMarket(t, db, 1, 1, 50)
	addRank(t, db, otherSong, chartDate, 1) // chart is in, our song is not on it

	if err := Resolve(ctx, db, marketID); err != nil {
		t.Fatal(err)
	}
	checkUser(t, db, id, 10_350, 350)
}

func TestBuyRejects(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	marketID, _, _ := newMarket(t, db, 50, 5, 99)
	pastClose, _, _ := newMarket(t, db, 50, 5, 50)
	if _, err := db.Exec(`UPDATE markets SET closes_at = now() - interval '1 second' WHERE id = $1`, pastClose); err != nil {
		t.Fatal(err)
	}
	id := newUser(t, db)

	for _, c := range []struct {
		market   int64
		side     string
		quantity int64
		want     error
	}{
		{marketID, "up", 1, ErrInvalidOrder},
		{marketID, "yes", 0, ErrInvalidOrder},
		{marketID, "yes", -1, ErrInvalidOrder}, // would otherwise credit notes
		{marketID, "yes", 1_000_001, ErrInvalidOrder},
		{0, "yes", 1, ErrMarketClosed},
		{pastClose, "yes", 1, ErrMarketClosed},       // trading stopped before the chart came out
		{marketID, "yes", 102, ErrInsufficientFunds}, // 102 x 99 = 10,098
	} {
		if _, err := Buy(ctx, db, id, c.market, c.side, c.quantity); !errors.Is(err, c.want) {
			t.Fatalf("Buy(%d, %q, %d): got %v, want %v", c.market, c.side, c.quantity, err, c.want)
		}
	}
	checkUser(t, db, id, StartingBalance, 0)
}

func TestBuyEndpoint(t *testing.T) {
	db := testDB(t)
	marketID, _, _ := newMarket(t, db, 50, 5, 62)
	id := newUser(t, db)

	anonymous := currentUser
	currentUser = func(*http.Request) (int64, bool) { return id, true } // stand-in for auth
	t.Cleanup(func() { currentUser = anonymous })

	for _, c := range []struct {
		body, want string
		code       int
	}{
		{`{"side":"yes","quantity":2}`, `{"balance":9876}`, http.StatusOK}, // 2 x 62
		{`{"side":"yes","quantity":0}`, "", http.StatusBadRequest},
		{`not json`, "", http.StatusBadRequest},
		{`{"side":"no","quantity":1000}`, "", http.StatusConflict}, // 1000 x 38 > balance
	} {
		res := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/markets/%d/buy", marketID), strings.NewReader(c.body))
		routes(db).ServeHTTP(res, req)
		if res.Code != c.code || (c.want != "" && strings.TrimSpace(res.Body.String()) != c.want) {
			t.Fatalf("POST %s: %d %s, want %d %s", c.body, res.Code, res.Body, c.code, c.want)
		}
	}
	checkUser(t, db, id, 9_876, 0)
}
