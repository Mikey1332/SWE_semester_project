package main

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestFailureLogging(t *testing.T) {
	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ok", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("hi")) })
	mux.HandleFunc("GET /bad/{id}", func(w http.ResponseWriter, r *http.Request) { http.Error(w, "no", 400) })
	mux.HandleFunc("GET /fail/{id}", func(w http.ResponseWriter, r *http.Request) { http.Error(w, "boom", 500) })
	mux.HandleFunc("GET /panic", func(w http.ResponseWriter, r *http.Request) { panic("kaboom") })
	h := withFailureLogging(mux)

	get := func(path string) *httptest.ResponseRecorder {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest("GET", path, nil))
		return rr
	}

	get("/ok")
	get("/bad/7")
	if buf.Len() != 0 {
		t.Fatalf("2xx and 4xx must not be logged, got %q", buf.String())
	}

	rr := get("/fail/123")
	out := buf.String()
	if rr.Code != 500 || !strings.Contains(out, "api failure") ||
		!strings.Contains(out, "GET /fail/{id}") || strings.Contains(out, "123") {
		t.Fatalf("bad failure log: code=%d log=%q", rr.Code, out)
	}

	buf.Reset()
	rr = get("/panic")
	if rr.Code != 500 || !strings.Contains(buf.String(), "api panic") {
		t.Fatalf("panic not handled: code=%d log=%q", rr.Code, buf.String())
	}
}
