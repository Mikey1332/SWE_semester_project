package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/option"
)

var (
	errNotSignedIn = errors.New("sign-in required")
	errNoDatabase  = errors.New("database not configured: start PostgreSQL, set DATABASE_URL and restart the backend")
)

// currentUser returns the signed-in ledger user for a request. main points it
// at firebaseUser; until then (and in tests) every request is anonymous.
var currentUser = func(r *http.Request) (int64, error) { return 0, errNotSignedIn }

// firebaseUser verifies the request's Firebase ID token ("Authorization: Bearer
// TOKEN") and returns the matching ledger user, creating it with the starting
// balance on first sign-in.
func firebaseUser(authClient *auth.Client, db *sql.DB) func(*http.Request) (int64, error) {
	return func(r *http.Request) (int64, error) {
		idToken, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok {
			return 0, errNotSignedIn
		}
		token, err := authClient.VerifyIDToken(r.Context(), idToken)
		if err != nil {
			log.Printf("firebase rejected sign-in token: %v", err) // expired, wrong project, clock skew...
			return 0, errNotSignedIn
		}
		email, _ := token.Claims["email"].(string)
		return UserForFirebase(r.Context(), db, token.UID, email)
	}
}

// signedIn returns the request's user, or writes 401/500 and returns false.
func signedIn(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := currentUser(r)
	switch {
	case errors.Is(err, errNoDatabase):
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return 0, false
	case errors.Is(err, errNotSignedIn):
		http.Error(w, "sign-in required", http.StatusUnauthorized)
		return 0, false
	case err != nil:
		log.Printf("sign-in: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return 0, false
	}
	return id, true
}

// trade handles a signed-in buy or sell of a market's contracts.
func trade(db *sql.DB, action string,
	do func(context.Context, *sql.DB, int64, int64, string, int64) (int64, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := signedIn(w, r)
		if !ok {
			return
		}
		if db == nil {
			http.Error(w, errNoDatabase.Error(), http.StatusServiceUnavailable)
			return
		}
		marketID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			http.Error(w, "invalid market id", http.StatusBadRequest)
			return
		}
		var req struct {
			Side     string `json:"side"`
			Quantity int64  `json:"quantity"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&req); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}

		balance, err := do(r.Context(), db, userID, marketID, req.Side, req.Quantity)
		switch {
		case errors.Is(err, ErrInvalidOrder):
			http.Error(w, err.Error(), http.StatusBadRequest)
		case errors.Is(err, ErrMarketClosed), errors.Is(err, ErrInsufficientFunds), errors.Is(err, ErrNotEnoughContracts):
			http.Error(w, err.Error(), http.StatusConflict)
		case err != nil:
			log.Printf("%s market %d user %d: %v", action, marketID, userID, err)
			http.Error(w, "internal error", http.StatusInternalServerError)
		default:
			writeJSON(w, map[string]int64{"balance": balance})
		}
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// serveLeaderboard answers ?period=week|month|all (default week) with the top 100.
func serveLeaderboard(w http.ResponseWriter, r *http.Request, db *sql.DB, groupID *int64) {
	if db == nil {
		http.Error(w, errNoDatabase.Error(), http.StatusServiceUnavailable)
		return
	}
	period := r.URL.Query().Get("period")
	if period == "" {
		period = "week"
	}
	board, err := Leaderboard(r.Context(), db, period, groupID)
	switch {
	case errors.Is(err, ErrInvalidPeriod):
		http.Error(w, err.Error(), http.StatusBadRequest)
	case err != nil:
		log.Printf("leaderboard: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
	default:
		writeJSON(w, board[:min(len(board), 100)])
	}
}

func routes(db *sql.DB) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Markets the bots opened that still accept trades, by chart date then current rank.
	// Public: browsing needs no sign-in.
	mux.HandleFunc("GET /markets", func(w http.ResponseWriter, r *http.Request) {
		if db == nil {
			http.Error(w, errNoDatabase.Error(), http.StatusServiceUnavailable)
			return
		}
		type market struct {
			ID           int64     `json:"id"`
			Title        string    `json:"title"`
			Artist       string    `json:"artist"`
			ChartDate    string    `json:"chart_date"`
			BaselineRank int       `json:"baseline_rank"`
			Shift        int       `json:"shift"`
			YesPrice     int       `json:"yes_price"`
			NoPrice      int       `json:"no_price"`
			ClosesAt     time.Time `json:"closes_at"`
			// Contracts bought so far, and the song's last 10 Hot 100 ranks
			// (oldest first) up to the chart the market starts from.
			Volume  int64           `json:"volume"`
			History json.RawMessage `json:"history"`
			// Billboard genre charts the song has appeared on, e.g. "rock-songs".
			Genres json.RawMessage `json:"genres"`
		}
		rows, err := db.QueryContext(r.Context(), `
			SELECT m.id, s.title, s.artist, m.chart_date::text, m.baseline_rank, m.shift,
			       m.yes_price, $1 - m.yes_price, m.closes_at,
			       coalesce((SELECT sum(l.quantity) FROM ledger_entries l
			                 WHERE l.market_id = m.id AND l.kind = 'buy'), 0),
			       coalesce((SELECT json_agg(json_build_object('chart_date', h.chart_date::text, 'rank', h.rank)
			                                 ORDER BY h.chart_date)
			                 FROM (SELECT chart_date, rank FROM chart_snapshots c
			                       WHERE c.chart = 'hot-100' AND c.song_id = m.song_id AND c.chart_date < m.chart_date
			                       ORDER BY c.chart_date DESC LIMIT 10) h), '[]'),
			       coalesce((SELECT json_agg(DISTINCT c.chart) FROM chart_snapshots c
			                 WHERE c.song_id = m.song_id AND c.chart <> 'hot-100'), '[]')
			FROM markets m JOIN songs s ON s.id = m.song_id
			WHERE m.status = 'open' AND now() < m.closes_at
			ORDER BY m.chart_date, m.baseline_rank`, ContractPayout)
		if err != nil {
			log.Printf("markets: %v", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		markets := []market{}
		for rows.Next() {
			var m market
			if err := rows.Scan(&m.ID, &m.Title, &m.Artist, &m.ChartDate, &m.BaselineRank, &m.Shift,
				&m.YesPrice, &m.NoPrice, &m.ClosesAt, &m.Volume, &m.History, &m.Genres); err != nil {
				log.Printf("markets: %v", err)
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			markets = append(markets, m)
		}
		writeJSON(w, markets)
	})

	// Returns the signed-in user's ledger account and open contracts. The first
	// call creates the account with the starting balance.
	mux.HandleFunc("GET /auth/me", func(w http.ResponseWriter, r *http.Request) {
		userID, ok := signedIn(w, r)
		if !ok {
			return
		}
		if db == nil {
			http.Error(w, errNoDatabase.Error(), http.StatusServiceUnavailable)
			return
		}

		type position struct {
			MarketID  int64  `json:"market_id"`
			Side      string `json:"side"`
			Quantity  int64  `json:"quantity"`
			CostBasis int64  `json:"cost_basis"`
		}
		var body struct {
			UserID      int64      `json:"user_id"`
			UID         string     `json:"uid"`
			Email       string     `json:"email"`
			Balance     int64      `json:"balance"`
			RealizedPnL int64      `json:"realized_pnl"`
			Positions   []position `json:"positions"`
		}
		err := db.QueryRowContext(r.Context(),
			`SELECT u.id, u.firebase_uid, coalesce(u.email, ''), b.balance, p.realized_pnl
			 FROM users u
			 JOIN balances b ON b.user_id = u.id
			 JOIN user_pnl p ON p.user_id = u.id
			 WHERE u.id = $1`, userID).Scan(&body.UserID, &body.UID, &body.Email, &body.Balance, &body.RealizedPnL)
		if err == nil {
			var rows *sql.Rows
			rows, err = db.QueryContext(r.Context(),
				`SELECT market_id, side, quantity, cost_basis FROM positions
				 WHERE user_id = $1 ORDER BY market_id, side`, userID)
			if err == nil {
				body.Positions = []position{}
				for rows.Next() && err == nil {
					var p position
					err = rows.Scan(&p.MarketID, &p.Side, &p.Quantity, &p.CostBasis)
					body.Positions = append(body.Positions, p)
				}
				if err == nil {
					err = rows.Err()
				}
				rows.Close()
			}
		}
		if err != nil {
			log.Printf("auth/me %d: %v", userID, err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, body)
	})

	// The signed-in user's ledger, newest first: every grant, buy, sell and
	// payout, with the contracts it moved and how its market turned out.
	mux.HandleFunc("GET /me/ledger", func(w http.ResponseWriter, r *http.Request) {
		userID, ok := signedIn(w, r)
		if !ok {
			return
		}
		if db == nil {
			http.Error(w, errNoDatabase.Error(), http.StatusServiceUnavailable)
			return
		}
		type entry struct {
			ID           int64     `json:"id"`
			CreatedAt    time.Time `json:"created_at"`
			Kind         string    `json:"kind"`
			Amount       int64     `json:"amount"`
			BalanceAfter int64     `json:"balance_after"`
			Side         *string   `json:"side"`
			Quantity     *int64    `json:"quantity"`
			Price        *int64    `json:"price"`
			MarketID     *int64    `json:"market_id"`
			Title        *string   `json:"title"`
			Artist       *string   `json:"artist"`
			ChartDate    *string   `json:"chart_date"`
			BaselineRank *int      `json:"baseline_rank"`
			Shift        *int      `json:"shift"`
			Status       *string   `json:"market_status"`
			Outcome      *string   `json:"outcome"`
		}
		rows, err := db.QueryContext(r.Context(), `
			SELECT l.id, l.created_at, l.kind, l.amount, l.balance_after, l.side, l.quantity, l.price,
			       m.id, s.title, s.artist, m.chart_date::text, m.baseline_rank, m.shift, m.status, m.outcome
			FROM ledger_entries l
			LEFT JOIN markets m ON m.id = l.market_id
			LEFT JOIN songs s ON s.id = m.song_id
			WHERE l.user_id = $1
			ORDER BY l.id DESC
			LIMIT 500`, userID)
		if err != nil {
			log.Printf("me/ledger %d: %v", userID, err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		entries := []entry{}
		for rows.Next() {
			var e entry
			if err := rows.Scan(&e.ID, &e.CreatedAt, &e.Kind, &e.Amount, &e.BalanceAfter, &e.Side, &e.Quantity, &e.Price,
				&e.MarketID, &e.Title, &e.Artist, &e.ChartDate, &e.BaselineRank, &e.Shift, &e.Status, &e.Outcome); err != nil {
				log.Printf("me/ledger %d: %v", userID, err)
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			entries = append(entries, e)
		}
		if err := rows.Err(); err != nil {
			log.Printf("me/ledger %d: %v", userID, err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, entries)
	})

	// Body: {"side": "yes" | "no", "quantity": n}. Returns {"balance": n}.
	mux.HandleFunc("POST /markets/{id}/buy", trade(db, "buy", Buy))
	mux.HandleFunc("POST /markets/{id}/sell", trade(db, "sell", Sell))
	// Credits the weekly grant to the signed-in user. Returns {"balance": n}.
	mux.HandleFunc("POST /me/weekly-grant", func(w http.ResponseWriter, r *http.Request) {
		userID, ok := signedIn(w, r)
		if !ok {
			return
		}
		if db == nil {
			http.Error(w, errNoDatabase.Error(), http.StatusServiceUnavailable)
			return
		}
		balance, err := ClaimWeeklyGrant(r.Context(), db, userID)
		switch {
		case errors.Is(err, ErrGrantNotReady):
			http.Error(w, err.Error(), http.StatusConflict)
		case err != nil:
			log.Printf("weekly grant user %d: %v", userID, err)
			http.Error(w, "internal error", http.StatusInternalServerError)
		default:
			writeJSON(w, map[string]int64{"balance": balance})
		}
	})

	// ?period=week|month|all (default week). Public.
	mux.HandleFunc("GET /leaderboard", func(w http.ResponseWriter, r *http.Request) {
		serveLeaderboard(w, r, db, nil)
	})
	mux.HandleFunc("GET /groups/{id}/leaderboard", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			http.Error(w, "invalid group id", http.StatusBadRequest)
			return
		}
		serveLeaderboard(w, r, db, &id)
	})
	// Adds the signed-in user to a group. 204 on success.
	mux.HandleFunc("POST /groups/{id}/join", func(w http.ResponseWriter, r *http.Request) {
		userID, ok := signedIn(w, r)
		if !ok {
			return
		}
		if db == nil {
			http.Error(w, errNoDatabase.Error(), http.StatusServiceUnavailable)
			return
		}
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			http.Error(w, "invalid group id", http.StatusBadRequest)
			return
		}
		switch err := JoinGroup(r.Context(), db, userID, id); {
		case errors.Is(err, ErrNoSuchGroup):
			http.Error(w, err.Error(), http.StatusNotFound)
		case errors.Is(err, ErrAlreadyMember):
			http.Error(w, err.Error(), http.StatusConflict)
		case err != nil:
			log.Printf("join group %d user %d: %v", id, userID, err)
			http.Error(w, "internal error", http.StatusInternalServerError)
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	})

	return mux
}

func main() {
	ctx := context.Background()

	// Verifying ID tokens only needs the project ID and Google's public signing
	// keys, so no service-account credentials are required to run the backend.
	app, err := firebase.NewApp(ctx, &firebase.Config{
		ProjectID: "swe-project-auth",
	}, option.WithoutAuthentication())
	if err != nil {
		log.Fatalf("Firebase setup failed: %v", err)
	}

	authClient, err := app.Auth(ctx)
	if err != nil {
		log.Fatalf("Firebase authentication setup failed: %v", err)
	}

	var db *sql.DB
	if url := os.Getenv("DATABASE_URL"); url != "" {
		if db, err = sql.Open("pgx", url); err != nil {
			log.Fatal(err)
		}
		if err := Migrate(ctx, db); err != nil {
			log.Fatalf("migrate: %v", err)
		}
		log.Println("Database migrated")
		currentUser = firebaseUser(authClient, db)
		go RunBots(ctx, db)
	} else {
		log.Println("DATABASE_URL not set: sign-in and trading return 503 until it is set")
		currentUser = func(*http.Request) (int64, error) { return 0, errNoDatabase }
	}

	server := &http.Server{
		Addr:              ":8080",
		Handler:           routes(db),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Println("Backend listening on http://localhost:8080")
	log.Fatal(server.ListenAndServe())
}
