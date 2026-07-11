import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import http from 'node:http'
import https from 'node:https'

function genericOpenAICompatibleProxyPlugin() {
  return {
    name: 'storyforge-generic-openai-compatible-proxy',
    configureServer(server: {
      middlewares: { use(handler: (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void): void }
    }) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url || ''
        if (!rawUrl.startsWith('/openai-compatible-proxy/')) return next()

        const requestUrl = new URL(rawUrl, 'http://localhost')
        const rawBaseUrl = (requestUrl.searchParams.get('baseUrl') || '').trim().replace(/\/+$/, '')
        if (!/^https?:\/\//i.test(rawBaseUrl)) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: { message: 'Missing or invalid baseUrl' } }))
          return
        }

        const upstream = new URL(rawBaseUrl)
        const suffix = requestUrl.pathname.replace(/^\/openai-compatible-proxy/, '')
        const query = new URLSearchParams(requestUrl.searchParams)
        query.delete('baseUrl')
        const upstreamPath = `${upstream.pathname.replace(/\/+$/, '')}${suffix}${query.toString() ? `?${query.toString()}` : ''}`
        const transport = upstream.protocol === 'https:' ? https : http

        const headers: http.OutgoingHttpHeaders = { ...req.headers, host: upstream.host }
        delete headers.origin
        delete headers.referer

        const proxyReq = transport.request({
          protocol: upstream.protocol,
          hostname: upstream.hostname,
          port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
          method: req.method,
          path: upstreamPath,
          headers,
        }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
          proxyRes.pipe(res)
        })

        proxyReq.on('error', (err) => {
          if (res.headersSent) {
            res.end()
            return
          }
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: { message: `Proxy error: ${err.message}` } }))
        })

        req.on('aborted', () => proxyReq.destroy())
        req.pipe(proxyReq)
      })
    },
  }
}

export default defineConfig({
  plugins: [
    genericOpenAICompatibleProxyPlugin(),
    react(),
    VitePWA({
      injectRegister: null,
      registerType: 'autoUpdate',
      base: '/storyforge/',
      scope: '/storyforge/',
      manifest: {
        name: '故事熔炉 StoryForge',
        short_name: '故事熔炉',
        description: 'AI 驱动的小说创作工坊',
        theme_color: '#6366f1',
        background_color: '#0a0a0f',
        display: 'standalone',
        start_url: '/storyforge/',
        scope: '/storyforge/',
        lang: 'zh-CN',
        icons: [
          {
            src: '/storyforge/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/storyforge/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/storyforge/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/storyforge/index.html',
        navigateFallbackDenylist: [/^\/(?!storyforge)/],
        // 主 bundle 已随功能增多突破 2 MiB（pdf.js + mammoth + 分块流水线），
        // 放宽到 5 MiB 让它被精确预缓存而不是只靠 runtime cache。
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Google Fonts
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  base: '/storyforge/',
  server: {
    port: 1111,
    // CF-1: 端口被占用时直接失败报错，而不是静默换到 1112 —— 避免用户以为在 1111、
    // 实际打开的却是被旧进程占用的 1111（错误服务 / 重定向循环）。
    strictPort: true,
    open: '/storyforge/',
    proxy: {
      '/deepseek-proxy': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/deepseek-proxy/, ''),
        secure: true,
      },
      '/openai-proxy': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/openai-proxy/, ''),
        secure: true,
      },
      '/kimi-proxy': {
        target: 'https://api.moonshot.cn',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/kimi-proxy/, ''),
        secure: true,
      },
      '/claude-proxy': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/claude-proxy/, ''),
        secure: true,
      },
      '/nvidia-proxy': {
        target: 'https://integrate.api.nvidia.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/nvidia-proxy/, ''),
        secure: true,
      },
      '/doubao-proxy': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/doubao-proxy/, ''),
        secure: true,
      },
      '/agnes-proxy': {
        target: 'https://apihub.agnes-ai.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/agnes-proxy/, ''),
        secure: true,
      },
      '/longcat-proxy': {
        target: 'https://api.longcat.chat',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/longcat-proxy/, ''),
        secure: true,
      },
      '/opencode-proxy': {
        target: 'https://opencode.ai',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/opencode-proxy/, '/zen/go'),
        secure: true,
      },
      // NS-5 embedding：国内嵌入服务本地代理（绕浏览器 CORS）
      '/siliconflow-proxy': {
        target: 'https://api.siliconflow.cn',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/siliconflow-proxy/, ''),
        secure: true,
      },
      '/qwen-proxy': {
        target: 'https://dashscope.aliyuncs.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/qwen-proxy/, ''),
        secure: true,
      },
      '/glm-proxy': {
        target: 'https://open.bigmodel.cn',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/glm-proxy/, ''),
        secure: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // 只把 react 固定成独立 vendor chunk（便于缓存）。
        // pdfjs / mammoth / three / jszip 均已通过「动态 import() 按需加载」自然分块，
        // 不可在此用 manualChunks 固定它们——否则会被并入主包静态引用、反而变回首屏 eager 加载。
        // Phase 3.5:把大的静态依赖拆成独立 vendor chunk。
        // 好处:① 主包变小、解析更快 ② 这些库很少变,浏览器可长期缓存(应用更新不必重下)。
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-editor': ['@tiptap/react', '@tiptap/starter-kit', '@tiptap/extension-placeholder'],
          'vendor-db': ['dexie'],
          'vendor-d3': ['d3-hierarchy'],
        },
      },
    },
  },
})
