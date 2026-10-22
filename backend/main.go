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

var errNotSignedIn = errors.New("sign-in required")

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

func routes(db *sql.DB) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Returns the signed-in user's ledger account. The first call creates it
	// with the starting balance.
	mux.HandleFunc("GET /auth/me", func(w http.ResponseWriter, r *http.Request) {
		userID, ok := signedIn(w, r)
		if !ok {
			return
		}
		if db == nil {
			http.Error(w, "database not configured", http.StatusServiceUnavailable)
			return
		}

		var body struct {
			UserID      int64  `json:"user_id"`
			UID         string `json:"uid"`
			Email       string `json:"email"`
			Balance     int64  `json:"balance"`
			RealizedPnL int64  `json:"realized_pnl"`
		}
		err := db.QueryRowContext(r.Context(),
			`SELECT u.id, u.firebase_uid, coalesce(u.email, ''), b.balance, p.realized_pnl
			 FROM users u
			 JOIN balances b ON b.user_id = u.id
			 JOIN user_pnl p ON p.user_id = u.id
			 WHERE u.id = $1`, userID).Scan(&body.UserID, &body.UID, &body.Email, &body.Balance, &body.RealizedPnL)
		if err != nil {
			log.Printf("auth/me %d: %v", userID, err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(body)
	})

	// Body: {"side": "yes" | "no", "quantity": n}. Returns {"balance": n}.
	mux.HandleFunc("POST /markets/{id}/buy", func(w http.ResponseWriter, r *http.Request) {
		userID, ok := signedIn(w, r)
		if !ok {
			return
		}
		if db == nil {
			http.Error(w, "database not configured", http.StatusServiceUnavailable)
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

		balance, err := Buy(r.Context(), db, userID, marketID, req.Side, req.Quantity)
		switch {
		case errors.Is(err, ErrInvalidOrder):
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		case errors.Is(err, ErrMarketClosed), errors.Is(err, ErrInsufficientFunds):
			http.Error(w, err.Error(), http.StatusConflict)
			return
		case err != nil:
			log.Printf("buy market %d user %d: %v", marketID, userID, err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]int64{"balance": balance})
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
		log.Println("DATABASE_URL not set; skipping database")
	}

	server := &http.Server{
		Addr:              ":8080",
		Handler:           routes(db),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Println("Backend listening on http://localhost:8080")
	log.Fatal(server.ListenAndServe())
}
