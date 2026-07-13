package main

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"testing/fstest"
	"time"
)

func TestDesktopServerServesStoryForgeSPAFromLegacyOrigin(t *testing.T) {
	assets := fstest.MapFS{
		"storyforge/index.html": &fstest.MapFile{Data: []byte("<main>StoryForge desktop</main>")},
	}
	handler := newDesktopServer("127.0.0.1:0", assets).Handler()
	request := httptest.NewRequest(http.MethodGet, "/storyforge/workspace/7", nil)
	request.Header.Set("Accept", "text/html")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Body.String() != "<main>StoryForge desktop</main>" {
		t.Fatalf("desktop SPA fallback failed: %d %q", response.Code, response.Body.String())
	}
}

func TestGenericProxyPreservesPathAndRemovesBaseURL(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_ = json.NewEncoder(response).Encode(map[string]string{
			"path":  request.URL.Path,
			"query": request.URL.RawQuery,
		})
	}))
	defer upstream.Close()

	request := httptest.NewRequest(http.MethodPost,
		"/openai-compatible-proxy/chat/completions?baseUrl="+url.QueryEscape(upstream.URL+"/v1")+"&trace=1", nil)
	response := httptest.NewRecorder()
	newDesktopServer("127.0.0.1:0", nil).Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", response.Code)
	}
	var payload map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["path"] != "/v1/chat/completions" || payload["query"] != "trace=1" {
		t.Fatalf("unexpected upstream request: %#v", payload)
	}
}

func TestDesktopCORSAllowsWailsAndRejectsUnknownOrigins(t *testing.T) {
	handler := newDesktopServer("127.0.0.1:0", nil).Handler()
	allowed := httptest.NewRequest(http.MethodOptions, "/openai-compatible-proxy/models", nil)
	allowed.Header.Set("Origin", "wails://wails.localhost")
	allowedResponse := httptest.NewRecorder()
	handler.ServeHTTP(allowedResponse, allowed)
	if allowedResponse.Code != http.StatusNoContent || allowedResponse.Header().Get("Access-Control-Allow-Origin") == "" {
		t.Fatalf("Wails origin was not allowed: %d %#v", allowedResponse.Code, allowedResponse.Header())
	}

	blocked := httptest.NewRequest(http.MethodOptions, "/openai-compatible-proxy/models", nil)
	blocked.Header.Set("Origin", "https://attacker.example")
	blockedResponse := httptest.NewRecorder()
	handler.ServeHTTP(blockedResponse, blocked)
	if blockedResponse.Code != http.StatusForbidden {
		t.Fatalf("unexpected blocked origin status: %d", blockedResponse.Code)
	}
}

func TestDesktopServerReleasesPortOnClose(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	_ = listener.Close()

	server := newDesktopServer(address, nil)
	if err := server.Start(); err != nil {
		t.Fatal(err)
	}
	response, err := http.Get("http://" + address + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()
	server.Close()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		probe, listenErr := net.Listen("tcp", address)
		if listenErr == nil {
			_ = probe.Close()
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("server did not release %s", address)
}
