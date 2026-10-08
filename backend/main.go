package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"os"
	"time"
)

func routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	return mux
}

func main() {
	if url := os.Getenv("DATABASE_URL"); url != "" {
		db, err := sql.Open("pgx", url)
		if err != nil {
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
		Handler:           routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Println("Backend listening on http://localhost:8080")
	log.Fatal(server.ListenAndServe())
}
