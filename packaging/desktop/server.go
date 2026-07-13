package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

const defaultListenAddr = "127.0.0.1:17831"

type proxyRoute struct {
	prefix string
	target string
}

var proxyRoutes = []proxyRoute{
	{prefix: "/deepseek-proxy", target: "https://api.deepseek.com"},
	{prefix: "/openai-proxy", target: "https://api.openai.com"},
	{prefix: "/kimi-proxy", target: "https://api.moonshot.cn"},
	{prefix: "/claude-proxy", target: "https://api.anthropic.com"},
	{prefix: "/nvidia-proxy", target: "https://integrate.api.nvidia.com"},
	{prefix: "/doubao-proxy", target: "https://ark.cn-beijing.volces.com"},
	{prefix: "/agnes-proxy", target: "https://apihub.agnes-ai.com"},
	{prefix: "/longcat-proxy", target: "https://api.longcat.chat"},
	{prefix: "/opencode-proxy", target: "https://opencode.ai/zen/go"},
	{prefix: "/siliconflow-proxy", target: "https://api.siliconflow.cn"},
	{prefix: "/qwen-proxy", target: "https://dashscope.aliyuncs.com"},
	{prefix: "/glm-proxy", target: "https://open.bigmodel.cn"},
}

type desktopServer struct {
	address string
	assets  fs.FS
	server  *http.Server
	handler http.Handler
	mu      sync.Mutex
}

func newDesktopServer(address string, assets fs.FS) *desktopServer {
	result := &desktopServer{address: address, assets: assets}
	result.handler = result.buildHandler()
	return result
}

func (server *desktopServer) Handler() http.Handler {
	return server.handler
}

func (server *desktopServer) Start() error {
	server.mu.Lock()
	defer server.mu.Unlock()
	if server.server != nil {
		return nil
	}

	listener, err := net.Listen("tcp", server.address)
	if err != nil {
		return err
	}

	httpServer := &http.Server{
		Handler:           server.handler,
		ReadHeaderTimeout: 30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	server.server = httpServer
	go func() {
		if serveErr := httpServer.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			log.Printf("[desktop-server] %v", serveErr)
		}
	}()
	return nil
}

func (server *desktopServer) Close() {
	server.mu.Lock()
	httpServer := server.server
	server.server = nil
	server.mu.Unlock()
	if httpServer == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}

func (server *desktopServer) buildHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(response).Encode(map[string]string{"status": "ok", "version": appVersion})
	})
	mux.HandleFunc("/openai-compatible-proxy/", genericProxyHandler)
	for _, route := range proxyRoutes {
		target, err := url.Parse(route.target)
		if err != nil {
			panic(err)
		}
		mux.Handle(route.prefix+"/", reverseProxy(target, route.prefix))
	}
	if server.assets != nil {
		storyforgeAssets, err := fs.Sub(server.assets, "storyforge")
		if err != nil {
			panic(err)
		}
		mux.HandleFunc("/storyforge-test-seed.json", func(response http.ResponseWriter, request *http.Request) {
			serveEmbedded(response, request, server.assets, "storyforge-test-seed.json", false)
		})
		mux.Handle("/storyforge/", storyforgeHandler(storyforgeAssets))
		mux.HandleFunc("/", func(response http.ResponseWriter, request *http.Request) {
			if request.URL.Path != "/" {
				http.NotFound(response, request)
				return
			}
			http.Redirect(response, request, "/storyforge/?storyforge-test=1", http.StatusTemporaryRedirect)
		})
	}
	return withDesktopCORS(mux)
}

func storyforgeHandler(assets fs.FS) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		name := strings.TrimPrefix(request.URL.Path, "/storyforge/")
		name = strings.TrimPrefix(path.Clean("/"+name), "/")
		if name == "." || name == "" {
			serveEmbedded(response, request, assets, "index.html", false)
			return
		}
		if !fs.ValidPath(name) {
			http.NotFound(response, request)
			return
		}
		info, err := fs.Stat(assets, name)
		if err == nil && !info.IsDir() {
			serveEmbedded(response, request, assets, name, strings.HasPrefix(name, "assets/"))
			return
		}
		if acceptsHTML(request) {
			serveEmbedded(response, request, assets, "index.html", false)
			return
		}
		http.NotFound(response, request)
	})
}

func serveEmbedded(response http.ResponseWriter, request *http.Request, assets fs.FS, name string, immutable bool) {
	contents, err := fs.ReadFile(assets, name)
	if err != nil {
		http.NotFound(response, request)
		return
	}
	if contentType := mime.TypeByExtension(path.Ext(name)); contentType != "" {
		response.Header().Set("Content-Type", contentType)
	}
	if immutable {
		response.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		response.Header().Set("Cache-Control", "no-store")
	}
	http.ServeContent(response, request, path.Base(name), time.Time{}, bytes.NewReader(contents))
}

func acceptsHTML(request *http.Request) bool {
	return request.Method == http.MethodGet && strings.Contains(request.Header.Get("Accept"), "text/html")
}

func desktopAssetMiddleware(proxyHandler http.Handler) assetserver.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			if isProxyPath(request.URL.Path) {
				proxyHandler.ServeHTTP(response, request)
				return
			}
			next.ServeHTTP(response, request)
		})
	}
}

func isProxyPath(requestPath string) bool {
	if strings.HasPrefix(requestPath, "/openai-compatible-proxy/") {
		return true
	}
	for _, route := range proxyRoutes {
		if strings.HasPrefix(requestPath, route.prefix+"/") {
			return true
		}
	}
	return false
}

func genericProxyHandler(response http.ResponseWriter, request *http.Request) {
	baseURL := strings.TrimSpace(request.URL.Query().Get("baseUrl"))
	target, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.Host == "" || target.User != nil {
		writeProxyError(response, http.StatusBadRequest, "Missing or invalid baseUrl")
		return
	}
	reverseProxy(target, "/openai-compatible-proxy").ServeHTTP(response, request)
}

func reverseProxy(target *url.URL, prefix string) http.Handler {
	return &httputil.ReverseProxy{
		Rewrite: func(proxyRequest *httputil.ProxyRequest) {
			incoming := proxyRequest.In.URL
			suffix := strings.TrimPrefix(incoming.Path, prefix)
			proxyRequest.Out.URL.Scheme = target.Scheme
			proxyRequest.Out.URL.Host = target.Host
			proxyRequest.Out.URL.Path = joinPath(target.Path, suffix)
			query := incoming.Query()
			query.Del("baseUrl")
			if target.RawQuery != "" {
				targetQuery, _ := url.ParseQuery(target.RawQuery)
				for key, values := range targetQuery {
					for _, value := range values {
						query.Add(key, value)
					}
				}
			}
			proxyRequest.Out.URL.RawQuery = query.Encode()
			proxyRequest.Out.Host = target.Host
			proxyRequest.Out.Header.Del("Origin")
			proxyRequest.Out.Header.Del("Referer")
		},
		FlushInterval: -1,
		ErrorLog:      log.New(os.Stderr, "[desktop-proxy] ", log.LstdFlags),
		ErrorHandler: func(response http.ResponseWriter, request *http.Request, err error) {
			log.Printf("[desktop-proxy] %s %s failed: %v", request.Method, request.URL.Path, err)
			writeProxyError(response, http.StatusBadGateway, "AI proxy request failed")
		},
	}
}

func joinPath(base, suffix string) string {
	base = strings.TrimRight(base, "/")
	if suffix == "" {
		if base == "" {
			return "/"
		}
		return base
	}
	if !strings.HasPrefix(suffix, "/") {
		suffix = "/" + suffix
	}
	return base + suffix
}

func writeProxyError(response http.ResponseWriter, status int, message string) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(map[string]any{
		"error": map[string]string{"message": message},
	})
}

func withDesktopCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		origin := request.Header.Get("Origin")
		if origin != "" {
			if !isAllowedDesktopOrigin(origin) {
				http.Error(response, "Forbidden origin", http.StatusForbidden)
				return
			}
			response.Header().Set("Access-Control-Allow-Origin", origin)
			response.Header().Set("Vary", "Origin")
			response.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Anthropic-Version, X-Api-Key")
			response.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}
		response.Header().Set("X-Content-Type-Options", "nosniff")
		response.Header().Set("Referrer-Policy", "no-referrer")
		if request.Method == http.MethodOptions {
			response.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(response, request)
	})
}

func isAllowedDesktopOrigin(origin string) bool {
	allowed := map[string]struct{}{
		"wails://wails.localhost": {},
		"http://wails.localhost":  {},
		"https://wails.localhost": {},
	}
	if _, ok := allowed[strings.ToLower(origin)]; ok {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := parsed.Hostname()
	return (parsed.Scheme == "http" || parsed.Scheme == "https") &&
		(host == "127.0.0.1" || host == "localhost" || host == "::1")
}
