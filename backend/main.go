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
	"time"
)

func routes(db *sql.DB) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	mux.HandleFunc("GET /users/{id}/balance", func(w http.ResponseWriter, r *http.Request) {
		if db == nil {
			http.Error(w, "database not configured", http.StatusServiceUnavailable)
			return
		}
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			http.Error(w, "invalid user id", http.StatusBadRequest)
			return
		}

		var body struct {
			Balance     int64 `json:"balance"`
			RealizedPnL int64 `json:"realized_pnl"`
		}
		err = db.QueryRowContext(r.Context(),
			`SELECT b.balance, p.realized_pnl
			 FROM balances b JOIN user_pnl p USING (user_id)
			 WHERE b.user_id = $1`, id).Scan(&body.Balance, &body.RealizedPnL)
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "user not found", http.StatusNotFound)
			return
		}
		if err != nil {
			log.Printf("balance %d: %v", id, err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(body)
	})

	return mux
}

func main() {
	var db *sql.DB
	if url := os.Getenv("DATABASE_URL"); url != "" {
		var err error
		if db, err = sql.Open("pgx", url); err != nil {
			log.Fatal(err)
		}
		if err := Migrate(context.Background(), db); err != nil {
			log.Fatalf("migrate: %v", err)
		}
		log.Println("Database migrated")
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
