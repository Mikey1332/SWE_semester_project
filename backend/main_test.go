package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealth(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()

	routes(nil).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.Code)
	}

	if response.Header().Get("Content-Type") != "application/json" {
		t.Fatal("expected JSON content type")
	}

	var body struct {
		Status string `json:"status"`
	}

	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}

	if body.Status != "ok" {
		t.Fatalf("expected status ok, got %q", body.Status)
	}
}

// Without a valid sign-in, nobody can buy.
func TestBuyRequiresLogin(t *testing.T) {
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/markets/1/buy", strings.NewReader(`{"side":"yes","quantity":1}`))

	routes(nil).ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", response.Code)
	}
}

// A request without "Authorization: Bearer TOKEN" never reaches Firebase.
func TestFirebaseUserNeedsBearerToken(t *testing.T) {
	signIn := firebaseUser(nil, nil)
	for _, header := range []string{"", "Basic abc", "bearer abc"} {
		request := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
		if header != "" {
			request.Header.Set("Authorization", header)
		}
		if _, err := signIn(request); !errors.Is(err, errNotSignedIn) {
			t.Fatalf("Authorization %q: got %v, want errNotSignedIn", header, err)
		}
	}
}

// Without a database the backend says so, rather than claiming the user isn't signed in.
func TestNoDatabaseIs503(t *testing.T) {
	anonymous := currentUser
	currentUser = func(*http.Request) (int64, error) { return 0, errNoDatabase }
	t.Cleanup(func() { currentUser = anonymous })

	for _, request := range []*http.Request{
		httptest.NewRequest(http.MethodGet, "/auth/me", nil),
		httptest.NewRequest(http.MethodPost, "/markets/1/buy", strings.NewReader(`{"side":"yes","quantity":1}`)),
	} {
		response := httptest.NewRecorder()
		routes(nil).ServeHTTP(response, request)
		if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "DATABASE_URL") {
			t.Fatalf("%s %s: got %d %q, want 503 mentioning DATABASE_URL",
				request.Method, request.URL.Path, response.Code, response.Body)
		}
	}
}

// A failure while looking up the user is a server error, not a sign-in error.
func TestSignInFailureIs500(t *testing.T) {
	anonymous := currentUser
	currentUser = func(*http.Request) (int64, error) { return 0, errors.New("database down") }
	t.Cleanup(func() { currentUser = anonymous })

	response := httptest.NewRecorder()
	routes(nil).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/auth/me", nil))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500, got %d", response.Code)
	}
}
