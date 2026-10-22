package main

import (
	"context"
	"database/sql"
	"encoding/json"
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
	uid := unique("uid")
	id, err := UserForFirebase(context.Background(), db, uid, uid+"@example.com")
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

	signInAs(t, id)
	res := httptest.NewRecorder()
	routes(db).ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/auth/me", nil))
	var me struct {
		Balance     int64 `json:"balance"`
		RealizedPnL int64 `json:"realized_pnl"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &me); err != nil || me.Balance != 8_000 || me.RealizedPnL != -2_500 {
		t.Fatalf("GET /auth/me: %d %s, want balance 8000 and realized_pnl -2500", res.Code, res.Body)
	}
}

// signInAs makes every request in this test act as userID, standing in for a
// verified Firebase token.
func signInAs(t *testing.T, userID int64) {
	t.Helper()
	anonymous := currentUser
	currentUser = func(*http.Request) (int64, error) { return userID, nil }
	t.Cleanup(func() { currentUser = anonymous })
}

// First sign-in creates the user with the starting grant; later and concurrent
// sign-ins return the same user and never grant twice.
func TestUserForFirebase(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	uid := unique("uid")

	ids := make([]int64, 10)
	var wg sync.WaitGroup
	for i := range ids {
		wg.Go(func() {
			id, err := UserForFirebase(ctx, db, uid, uid+"@example.com")
			if err != nil {
				t.Error(err)
			}
			ids[i] = id
		})
	}
	wg.Wait()
	again, err := UserForFirebase(ctx, db, uid, uid+"@example.com")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range append(ids, again) {
		if id != ids[0] {
			t.Fatalf("sign-ins returned different users: %v and %d", ids, again)
		}
	}

	var grants int
	if err := db.QueryRow(`SELECT count(*) FROM ledger_entries WHERE user_id = $1 AND kind = 'grant'`,
		ids[0]).Scan(&grants); err != nil {
		t.Fatal(err)
	}
	if grants != 1 {
		t.Fatalf("%d grants, want exactly 1", grants)
	}
	checkUser(t, db, ids[0], StartingBalance, 0)
}

func TestAuthMe(t *testing.T) {
	db := testDB(t)
	uid := unique("uid")
	id, err := UserForFirebase(context.Background(), db, uid, uid+"@example.com")
	if err != nil {
		t.Fatal(err)
	}

	res := httptest.NewRecorder()
	routes(db).ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/auth/me", nil))
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("GET /auth/me signed out: got %d, want 401", res.Code)
	}

	signInAs(t, id)
	res = httptest.NewRecorder()
	routes(db).ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/auth/me", nil))
	want := fmt.Sprintf(`{"user_id":%d,"uid":%q,"email":%q,"balance":10000,"realized_pnl":0}`, id, uid, uid+"@example.com")
	if res.Code != http.StatusOK || strings.TrimSpace(res.Body.String()) != want {
		t.Fatalf("GET /auth/me: %d %s, want 200 %s", res.Code, res.Body, want)
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

// fillChart puts a new filler song on every rank still empty on chartDate, so
// the chart counts as fully ingested.
func fillChart(t *testing.T, db *sql.DB, chartDate string) {
	t.Helper()
	_, err := db.Exec(`
		WITH free AS (
			SELECT g AS rank FROM generate_series(1, $3::int) g
			WHERE g NOT IN (SELECT rank FROM chart_snapshots WHERE chart_date = $1)
		), filler AS (
			INSERT INTO songs (title, artist) SELECT $2 || rank, 'Filler' FROM free RETURNING id, title
		)
		INSERT INTO chart_snapshots (song_id, chart_date, rank)
		SELECT id, $1, substr(title, length($2) + 1)::int FROM filler`,
		chartDate, unique("filler"), ChartSize)
	if err != nil {
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

// Buying 2,500 notes of contracts debits the balance once and records the
// purchase in the ledger.
func TestBuy2500RecordedInLedger(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	marketID, _, _ := newMarket(t, db, 50, 5, 50) // YES costs 50
	id := newUser(t, db)

	balance, err := Buy(ctx, db, id, marketID, "yes", 50) // 50 x 50 = 2,500
	if err != nil {
		t.Fatal(err)
	}
	if balance != 7_500 {
		t.Fatalf("balance after buy = %d, want 7500", balance)
	}

	var entries, amount, after, market int64
	var kind string
	err = db.QueryRow(`
		SELECT count(*), min(amount), min(balance_after), min(kind), min(market_id)
		FROM ledger_entries WHERE user_id = $1 AND kind <> 'grant'`, id).
		Scan(&entries, &amount, &after, &kind, &market)
	if err != nil {
		t.Fatal(err)
	}
	if entries != 1 || amount != -2_500 || after != 7_500 || kind != "buy" || market != marketID {
		t.Fatalf("ledger: entries=%d amount=%d balance_after=%d kind=%q market=%d, want 1 -2500 7500 buy %d",
			entries, amount, after, kind, market, marketID)
	}

	var quantity, cost int64
	if err := db.QueryRow(`SELECT quantity, cost_basis FROM positions WHERE user_id = $1 AND market_id = $2`,
		id, marketID).Scan(&quantity, &cost); err != nil {
		t.Fatal(err)
	}
	if quantity != 50 || cost != 2_500 {
		t.Fatalf("position: quantity=%d cost_basis=%d, want 50 and 2500", quantity, cost)
	}
	checkUser(t, db, id, 7_500, 0) // not a loss until the market resolves
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
	if err := Resolve(ctx, db, marketID); !errors.Is(err, ErrChartNotIn) {
		t.Fatalf("resolve on a half-loaded chart: got %v, want ErrChartNotIn", err)
	}

	fillChart(t, db, chartDate)
	for range 2 { // second Resolve must not pay twice
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
	fillChart(t, db, chartDate) // full chart without our song on it

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

	signInAs(t, id)

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
