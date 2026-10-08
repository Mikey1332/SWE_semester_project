package main

import (
	"log"
	"net/http"
	"time"
	"encoding/json"
)

type SignupRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

func routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /signup", func(w http.ResponseWriter, r *http.Request) {
		var req SignupRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if req.Username == "" {
			http.Error(w, "Username is required", http.StatusBadRequest)
			return
		}
		if req.Email == "" {
			http.Error(w, "Email is required", http.StatusBadRequest)
			return
		}
		if req.Password == "" {
			http.Error(w, "Password is required", http.StatusBadRequest)
			return
		}
		if len(req.Password) < 8 || len(req.Password) > 32 {
			http.Error(w, "Password must be between 8 and 32 bytes", http.StatusBadRequest)
			return
		}

		// Process the signup request
		// For now, we'll just return a success message
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"message":"Signup details received. Account creation is not connected yet."}`))
	})

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})
	return mux
}

func main() {
	server := &http.Server{
		Addr:              ":8080",
		Handler:           routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Println("Backend listening on http://localhost:8080")
	log.Fatal(server.ListenAndServe())
}
