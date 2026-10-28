// Command claude-usage serves the usage page and forwards its two data calls
// to CLIProxyAPI's /usage and /history routes, adding the history key.
package main

import (
	"embed"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// The all: prefix keeps SvelteKit's _app directory, which a plain pattern skips.
//
//go:embed all:web/build
var build embed.FS

// commit is set at build time with -ldflags "-X main.commit=<sha>".
var commit = "dev"

func main() {
	version := flag.Bool("version", false, "print the commit and exit")
	flag.Parse()
	if *version {
		fmt.Println(commit)
		return
	}
	if err := run(); err != nil {
		log.Printf("claude-usage: %v", err)
		os.Exit(1)
	}
}

func run() error {
	listen, err := env("CLAUDE_USAGE_LISTEN")
	if err != nil {
		return err
	}
	proxyURL, err := env("CLAUDE_USAGE_PROXY_URL")
	if err != nil {
		return err
	}
	key, err := env("CLAUDE_USAGE_HISTORY_KEY")
	if err != nil {
		return err
	}
	handler, err := newHandler(strings.TrimSuffix(proxyURL, "/"), key)
	if err != nil {
		return err
	}
	server := &http.Server{
		Addr:              listen,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("claude-usage %s listening on %s", commit, listen)
	return server.ListenAndServe()
}

func env(name string) (string, error) {
	v := os.Getenv(name)
	if v == "" {
		return "", fmt.Errorf("%s is not set", name)
	}
	return v, nil
}

// newHandler serves the embedded page, GET /api/usage and GET /api/history.
func newHandler(proxyURL, key string) (http.Handler, error) {
	page, err := fs.Sub(build, "web/build")
	if err != nil {
		return nil, err
	}
	// /usage fetches every account live from Anthropic, so allow it some time.
	client := &http.Client{Timeout: time.Minute}
	mux := http.NewServeMux()
	mux.Handle("GET /", http.FileServerFS(page))
	mux.Handle("GET /api/usage", forward(client, proxyURL+"/usage", key))
	mux.Handle("GET /api/history", forward(client, proxyURL+"/history", key))
	mux.Handle("GET /api/", http.NotFoundHandler())
	return mux, nil
}

// forward makes a plain GET to target with the history key and copies back
// the status, content type and body. Nothing from the incoming request is passed on.
func forward(client *http.Client, target, key string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
		if err != nil {
			log.Printf("claude-usage: build request: %v", err)
			http.Error(w, "bad proxy URL", http.StatusInternalServerError)
			return
		}
		req.Header.Set("Authorization", "Bearer "+key)
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("claude-usage: %s: %v", req.URL.Path, err)
			http.Error(w, "proxy unreachable", http.StatusBadGateway)
			return
		}
		defer func() {
			if err := resp.Body.Close(); err != nil {
				log.Printf("claude-usage: close %s response: %v", req.URL.Path, err)
			}
		}()
		if ct := resp.Header.Get("Content-Type"); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(resp.StatusCode)
		if _, err := io.Copy(w, resp.Body); err != nil && !errors.Is(err, r.Context().Err()) {
			log.Printf("claude-usage: copy %s response: %v", req.URL.Path, err)
		}
	})
}
