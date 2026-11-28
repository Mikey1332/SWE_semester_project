package main

import (
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"runtime/debug"
	"time"
)

// statusRecorder remembers the status code a handler wrote so the middleware
// can log it after the handler returns.
type statusRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (s *statusRecorder) WriteHeader(code int) {
	if !s.wroteHeader {
		s.status = code
		s.wroteHeader = true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if !s.wroteHeader {
		s.WriteHeader(http.StatusOK)
	}
	return s.ResponseWriter.Write(b)
}

func newRequestID() string {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		return "unknown"
	}
	return hex.EncodeToString(b)
}

// withFailureLogging logs every request that fails on our side (5xx) and turns
// a panicking handler into a logged 500. 4xx responses are not logged.
// The request ID is also returned in the X-Request-ID header.
func withFailureLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := newRequestID()
		w.Header().Set("X-Request-ID", id)
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()

		defer func() {
			// r.Pattern is set by the mux, e.g. "POST /markets/{id}/orders".
			route := r.Pattern
			if route == "" {
				route = r.Method + " " + r.URL.Path
			}

			if p := recover(); p != nil {
				if p == http.ErrAbortHandler {
					panic(p) // net/http uses this one on purpose
				}
				log.Printf("api panic: request=%s route=%q panic=%v\n%s", id, route, p, debug.Stack())
				if !rec.wroteHeader {
					http.Error(rec, "internal error", http.StatusInternalServerError)
				}
				return
			}

			if rec.status >= 500 {
				log.Printf("api failure: request=%s route=%q status=%d duration=%s",
					id, route, rec.status, time.Since(start).Round(time.Millisecond))
			}
		}()

		next.ServeHTTP(rec, r)
	})
}
