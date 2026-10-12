package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
)

func routes(authClient *auth.Client) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status": "ok",
		})
	})

	mux.HandleFunc("GET /auth/me", func(w http.ResponseWriter, r *http.Request) {
		// The frontend will send: Authorization: Bearer TOKEN
		header := r.Header.Get("Authorization")

		if !strings.HasPrefix(header, "Bearer ") {
			http.Error(w, "Sign-in token is required", http.StatusUnauthorized)
			return
		}

		idToken := strings.TrimPrefix(header, "Bearer ")

		token, err := authClient.VerifyIDToken(r.Context(), idToken)
		if err != nil {
			http.Error(w, "Invalid or expired sign-in token", http.StatusUnauthorized)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"uid":     token.UID,
			"message": "Go verified your Firebase sign-in!",
		})
	})

	return mux
}

func main() {
	ctx := context.Background()

	app, err := firebase.NewApp(ctx, &firebase.Config{
		ProjectID: "swe-project-auth",
	})
	if err != nil {
		log.Fatalf("Firebase setup failed: %v", err)
	}

	authClient, err := app.Auth(ctx)
	if err != nil {
		log.Fatalf("Firebase authentication setup failed: %v", err)
	}

	server := &http.Server{
		Addr:              ":8080",
		Handler:           routes(authClient),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Println("Backend listening on http://localhost:8080")
	log.Fatal(server.ListenAndServe())
}
