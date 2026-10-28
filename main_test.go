package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func get(t *testing.T, h http.Handler, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func TestForwardsWithHistoryKey(t *testing.T) {
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"path":"`+r.URL.Path+`"}`)
	}))
	defer proxy.Close()
	h, err := newHandler(proxy.URL, "secret")
	if err != nil {
		t.Fatal(err)
	}

	for path, want := range map[string]string{"/api/usage": "/usage", "/api/history": "/history"} {
		rec := get(t, h, http.MethodGet, path)
		if rec.Code != http.StatusOK || rec.Body.String() != `{"path":"`+want+`"}` {
			t.Errorf("%s: got %d %q", path, rec.Code, rec.Body.String())
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
			t.Errorf("%s: content type %q", path, ct)
		}
	}
}

func TestPassesProxyStatus(t *testing.T) {
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "history unavailable", http.StatusInternalServerError)
	}))
	defer proxy.Close()
	h, err := newHandler(proxy.URL, "secret")
	if err != nil {
		t.Fatal(err)
	}
	if rec := get(t, h, http.MethodGet, "/api/history"); rec.Code != http.StatusInternalServerError {
		t.Errorf("got %d", rec.Code)
	}
}

func TestProxyDown(t *testing.T) {
	proxy := httptest.NewServer(http.NotFoundHandler())
	proxy.Close()
	h, err := newHandler(proxy.URL, "secret")
	if err != nil {
		t.Fatal(err)
	}
	if rec := get(t, h, http.MethodGet, "/api/usage"); rec.Code != http.StatusBadGateway {
		t.Errorf("got %d", rec.Code)
	}
}

func TestServesNothingElse(t *testing.T) {
	h, err := newHandler("http://127.0.0.1:1", "secret")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		method, path string
		want         int
	}{
		{http.MethodPost, "/api/usage", http.StatusMethodNotAllowed},
		{http.MethodGet, "/api/other", http.StatusNotFound},
		{http.MethodGet, "/usage", http.StatusNotFound},
		{http.MethodPost, "/", http.StatusMethodNotAllowed},
	} {
		if rec := get(t, h, tc.method, tc.path); rec.Code != tc.want {
			t.Errorf("%s %s: got %d, want %d", tc.method, tc.path, rec.Code, tc.want)
		}
	}
}

// The page must come with SvelteKit's _app files, which only all:web/build embeds.
func TestServesEmbeddedPage(t *testing.T) {
	h, err := newHandler("http://127.0.0.1:1", "secret")
	if err != nil {
		t.Fatal(err)
	}
	rec := get(t, h, http.MethodGet, "/")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<title>Claude usage</title>") {
		t.Fatalf("/: got %d", rec.Code)
	}
	if rec := get(t, h, http.MethodGet, "/_app/version.json"); rec.Code != http.StatusOK {
		t.Errorf("/_app/version.json: got %d", rec.Code)
	}
}
