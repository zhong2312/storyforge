import { useState, useEffect, useSyncExternalStore } from 'react'
import { Wifi, WifiOff, Eye, EyeOff, CheckCircle, Trash2, ScrollText } from 'lucide-react'
import { useAIConfigStore, type TestResult } from '../../stores/ai-config'
import EmbeddingConfigCard from './EmbeddingConfigCard'
import type { AIProvider } from '../../lib/types'
import { PROVIDER_MODELS } from '../../lib/types'
import { isAIConfigReady } from '../../lib/ai/config-readiness'
import { getLogs, subscribeLogs, clearLogs, formatLog } from '../../lib/ai/logger'
import { applyStoryForgeTheme, resolveStoryForgeTheme, THEME_OPTIONS, type StoryForgeTheme } from '../../lib/theme'
import ModelCatalogSection from './ModelCatalogSection'
import { PROVIDER_OPTIONS } from './provider-options'
export { PROVIDER_OPTIONS } from './provider-options'

export default function AIConfigPanel() {
  const { config, setConfig, switchProvider, testConnection,
    rememberApiKey, setRememberApiKey } = useAIConfigStore()
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [currentTheme, setCurrentTheme] = useState<StoryForgeTheme>(() =>
    resolveStoryForgeTheme(localStorage.getItem('storyforge-theme')),
  )

  // 订阅日志变化
  const logs = useSyncExternalStore(subscribeLogs, getLogs)

  const currentProviderInfo = PROVIDER_OPTIONS.find((p) => p.value === config.provider)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testConnection()
      setTestResult(result)
    } finally {
      setTesting(false)
    }
  }

  const handleThemeChange = (theme: StoryForgeTheme) => {
    setCurrentTheme(theme)
    applyStoryForgeTheme(theme)
  }

  // 切换 provider 时清空测试结果
  useEffect(() => {
    setTestResult(null)
  }, [config.provider])

  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-bold text-text-primary mb-6">设置</h2>

      {/* AI 配置 */}
      <div className="bg-bg-surface border border-border rounded-xl p-5 mb-6">
        <h3 className="text-base font-semibold text-text-primary mb-4">AI 模型配置</h3>
        <p className="text-[11px] text-text-muted mb-4 rounded-lg border border-border bg-bg-base px-3 py-2">
          Web/PWA 中 API Key 默认仅保存在本次浏览器会话；Portable 的独立本机配置默认记住 Key，仍可手动关闭。发起 AI 生成、测试连接或使用自定义 baseUrl 时，相关提示词和上下文会发送到你配置的模型服务。
        </p>

        <ModelCatalogSection />

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-1.5">提供商</label>
            <select
              value={config.provider}
              onChange={(e) => switchProvider(e.target.value as AIProvider)}
              className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent transition-colors"
            >
              {PROVIDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}{!opt.cors ? ' ⚠️' : ''}
                </option>
              ))}
            </select>
            {/* 配置提示 */}
            {currentProviderInfo && (
              <p className={`mt-1.5 text-xs ${currentProviderInfo.cors ? 'text-text-muted' : 'text-amber-500'}`}>
                {currentProviderInfo.hint}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1.5">API Key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={config.apiKey}
                onChange={(e) => setConfig({ apiKey: e.target.value })}
                placeholder={config.provider === 'ollama' ? '不需要 Key' : '输入 API Key...'}
                className="w-full px-3 py-2 pr-10 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-secondary"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <label className="mt-2 flex items-start gap-2 text-[11px] text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={rememberApiKey}
                onChange={e => setRememberApiKey(e.target.checked)}
                className="mt-0.5 accent-accent"
              />
              <span>
                在本机记住 API Key（写入 localStorage）。不勾选时仅本次浏览器会话有效。
              </span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1.5">Base URL</label>
              <input
                type="text"
                value={config.baseUrl}
                onChange={(e) => setConfig({ baseUrl: e.target.value })}
                className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent transition-colors"
              />
              {['custom', 'ollama'].includes(config.provider) && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setConfig({ provider: 'custom', baseUrl: 'http://localhost:1234/v1', apiKey: config.apiKey || 'lm-studio', model: 'qwen3-14b' })}
                    className="text-xs px-2 py-1 rounded bg-bg-elevated text-text-secondary border border-border hover:text-accent hover:border-accent/50 transition-colors"
                  >
                    LM Studio
                  </button>
                  <button
                    onClick={() => setConfig({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: config.apiKey || 'ollama', model: 'qwen2.5:7b' })}
                    className="text-xs px-2 py-1 rounded bg-bg-elevated text-text-secondary border border-border hover:text-accent hover:border-accent/50 transition-colors"
                  >
                    本地 Ollama
                  </button>
                </div>
              )}
              {['custom', 'ollama'].includes(config.provider) && (
                <p className="mt-1 text-[11px] text-text-muted">
                  本地模型请选择 OpenAI 兼容接口，Base URL 填到 /v1；Ollama 常用 :11434/v1，LM Studio 常用 :1234/v1。不要填 /v1/models 或 /chat/completions，测试时会自动修正常见误填。
                </p>
              )}
              {(() => {
                // 需要代理的 provider 及其代理路径 / 原始地址映射
                const PROXY_MAP: Record<string, { proxy: string; direct: string }> = {
                  deepseek: { proxy: '/deepseek-proxy/v1', direct: 'https://api.deepseek.com/v1' },
                  openai:   { proxy: '/openai-proxy/v1',   direct: 'https://api.openai.com/v1' },
                  kimi:     { proxy: '/kimi-proxy/v1',     direct: 'https://api.moonshot.cn/v1' },
                  claude:   { proxy: '/claude-proxy/v1',   direct: 'https://api.anthropic.com/v1' },
                  nvidia:   { proxy: '/nvidia-proxy/v1',   direct: 'https://integrate.api.nvidia.com/v1' },
                  doubao:   { proxy: '/doubao-proxy/api/v3', direct: 'https://ark.cn-beijing.volces.com/api/v3' },
                  agnes:    { proxy: '/agnes-proxy/v1',    direct: 'https://apihub.agnes-ai.com/v1' },
                  longcat:  { proxy: '/longcat-proxy/openai/v1', direct: 'https://api.longcat.chat/openai/v1' },
                  opencode: { proxy: '/opencode-proxy/v1',  direct: 'https://opencode.ai/zen/go/v1' },
                }
                const pm = PROXY_MAP[config.provider]
                if (!pm) return null
                const isProxy = config.baseUrl.startsWith('/' + config.provider)
                return (
                  <div className="mt-1.5 flex gap-2">
                    {!isProxy ? (
                      <button
                        onClick={() => setConfig({ baseUrl: pm.proxy })}
                        className="text-xs px-2 py-1 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
                      >
                        🔄 切换到本地代理
                      </button>
                    ) : (
                      <button
                        onClick={() => setConfig({ baseUrl: pm.direct })}
                        className="text-xs px-2 py-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                      >
                        🔗 恢复直连
                      </button>
                    )}
                  </div>
                )
              })()}
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1.5">模型</label>
              {PROVIDER_MODELS[config.provider] ? (
                <>
                  <select
                    value={config.model}
                    onChange={(e) => setConfig({ model: e.target.value })}
                    className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent transition-colors"
                  >
                    {!PROVIDER_MODELS[config.provider].some(model => model.value === config.model) && (
                      <option value={config.model}>{config.model}（当前自定义）</option>
                    )}
                    {PROVIDER_MODELS[config.provider].map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.value}
                      </option>
                    ))}
                  </select>
                  {(() => {
                    const selected = PROVIDER_MODELS[config.provider]?.find((m) => m.value === config.model)
                    return selected?.desc ? (
                      <p className="mt-1 text-xs text-text-muted">{selected.desc}</p>
                    ) : null
                  })()}
                  {/* 自定义模型名：列表里没有的模型可手动输入 */}
                  <input
                    type="text"
                    value={config.model}
                    onChange={(e) => setConfig({ model: e.target.value })}
                    placeholder="或手动输入模型名（列表中没有的型号）"
                    className="mt-1.5 w-full px-3 py-1.5 bg-bg-base border border-border rounded-lg text-text-primary text-xs focus:outline-none focus:border-accent transition-colors"
                  />
                </>
              ) : (
                <input
                  type="text"
                  value={config.model}
                  onChange={(e) => setConfig({ model: e.target.value })}
                  className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent transition-colors"
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1.5">
                Temperature: {config.temperature}
              </label>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={config.temperature}
                onChange={(e) => setConfig({ temperature: Number(e.target.value) })}
                className="w-full accent-accent"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1.5">
                Max Tokens:
                {config.maxTokens === 0
                  ? <span className="text-accent font-normal ml-1">不限制（模型最大）</span>
                  : <><span className="ml-1">{config.maxTokens}</span><span className="text-text-muted font-normal ml-1">（≈{Math.round(config.maxTokens * 0.6)}字）</span></>
                }
              </label>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-text-secondary whitespace-nowrap cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.maxTokens === 0}
                    onChange={(e) => setConfig({ maxTokens: e.target.checked ? 0 : 8192 })}
                    className="accent-accent"
                  />
                  不限
                </label>
                {config.maxTokens > 0 && (
                  <input
                    type="range"
                    min={1024}
                    max={65536}
                    step={1024}
                    value={config.maxTokens}
                    onChange={(e) => setConfig({ maxTokens: Number(e.target.value) })}
                    className="w-full accent-accent"
                  />
                )}
              </div>
              {config.maxTokens > 0 && (
                <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
                  <span>1K</span><span>16K</span><span>32K</span><span>64K</span>
                </div>
              )}
            </div>
          </div>

          {/* FB-8: 上下文窗口(高级·可选) — 本地/自定义模型按实际填写,修"误报超出窗口" */}
          <div className="mb-4">
            <label className="block text-sm text-text-secondary mb-1.5">
              上下文窗口 <span className="text-text-muted font-normal">(高级 · 可选)</span>
              {config.contextWindow
                ? <span className="text-accent ml-1">{config.contextWindow.toLocaleString()} token</span>
                : <span className="text-text-muted ml-1">按模型预设</span>}
            </label>
            <input
              type="number"
              min={0}
              value={config.contextWindow || ''}
              onChange={(e) => setConfig({ contextWindow: Number(e.target.value) || undefined })}
              placeholder="本地/自定义模型请按实际填写，如 131072；留空 = 用内置预设"
              className="w-full px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
            />
            <p className="text-[11px] text-text-muted mt-1">
              识别不到的模型默认按 8K 计算,会误报「上下文超出窗口」。本地模型(LM Studio / Ollama)请在此填真实窗口,如 128000 / 262144。
            </p>
            <div className="mt-3">
              <label className="mb-1.5 block text-sm text-text-secondary">
                Agent 上下文压缩阈值
                <span className="ml-1 text-accent">{Math.round((config.contextCompressionThreshold ?? 0.8) * 100)}%</span>
              </label>
              <input
                type="range"
                min={50}
                max={95}
                step={5}
                value={Math.round((config.contextCompressionThreshold ?? 0.8) * 100)}
                onChange={(event) => setConfig({ contextCompressionThreshold: Number(event.target.value) / 100 })}
                className="w-full accent-accent"
              />
              <p className="mt-1 text-[11px] text-text-muted">
                会话、工具结果、系统指令和输出预留达到模型上下文窗口的该比例后，自动把较早内容压缩为摘要。
              </p>
            </div>
          </div>

          {/* 测试连接 */}
          <div className="pt-2 space-y-2">
            <div className="flex items-center gap-3">
              <button
                onClick={handleTest}
                disabled={testing || !isAIConfigReady(config)}
                className="flex items-center gap-2 px-4 py-2 bg-accent/10 text-accent rounded-lg hover:bg-accent/20 disabled:opacity-40 transition-colors text-sm"
              >
                {testing ? (
                  <span className="animate-spin">⏳</span>
                ) : testResult?.ok ? (
                  <CheckCircle className="w-4 h-4" />
                ) : testResult && !testResult.ok ? (
                  <WifiOff className="w-4 h-4" />
                ) : (
                  <Wifi className="w-4 h-4" />
                )}
                {testing ? '测试中...' : '测试连接'}
              </button>
              <button
                onClick={() => setShowLogs(!showLogs)}
                className="flex items-center gap-1.5 px-3 py-2 text-text-muted hover:text-text-secondary text-sm transition-colors"
              >
                <ScrollText className="w-4 h-4" />
                日志 {logs.length > 0 && `(${logs.length})`}
              </button>
            </div>
            {/* 测试结果详情 */}
            {testResult && (
              <div className={`text-sm px-3 py-2 rounded-lg ${testResult.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                <p>{testResult.message}</p>
                {testResult.duration && (
                  <p className="text-xs mt-0.5 opacity-70">耗时 {testResult.duration}ms</p>
                )}
              </div>
            )}
            {/* CORS 错误提示 */}
            {testResult && !testResult.ok && config.provider === 'deepseek' &&
              (testResult.message.includes('CORS') || testResult.message.includes('网络错误')) && (
              <p className="text-xs text-amber-400 px-1">
                {import.meta.env.DEV
                  ? '💡 本地运行时，可点击「切换到本地代理」解决此问题'
                  : '💡 建议改用 Gemini（支持浏览器直调）或在本地运行此工具'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* NS-5 · 语义检索(embedding) 配置卡 */}
      <EmbeddingConfigCard />

      {/* 日志面板 */}
      {showLogs && (
        <div className="bg-bg-surface border border-border rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-text-primary">连接日志</h3>
            <button
              onClick={clearLogs}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary"
            >
              <Trash2 className="w-3 h-3" /> 清空
            </button>
          </div>
          <div className="max-h-[200px] overflow-y-auto space-y-1 font-mono text-xs">
            {logs.length === 0 ? (
              <p className="text-text-muted">暂无日志，点击「测试连接」生成</p>
            ) : (
              logs.map((log) => (
                <pre key={log.id} className="text-text-secondary whitespace-pre-wrap break-all">
                  {formatLog(log)}
                </pre>
              ))
            )}
          </div>
        </div>
      )}

      {/* 主题切换 */}
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <h3 className="text-base font-semibold text-text-primary mb-4">主题</h3>
        <div className="flex flex-col gap-3">
          {THEME_OPTIONS.map((theme) => {
            const isActive = currentTheme === theme.value
            return (
              <button
                key={theme.value}
                onClick={() => handleThemeChange(theme.value)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                  isActive
                    ? 'border-accent bg-accent/10'
                    : 'border-border hover:border-border-hover hover:bg-bg-hover'
                }`}
              >
                {/* 色块预览 */}
                <div className="flex items-end gap-1 flex-shrink-0">
                  {theme.swatches.map((c, j) => (
                    <div
                      key={j}
                      style={{
                        width: j === 0 ? 28 : 18,
                        height: j === 0 ? 28 : 18,
                        background: c,
                        borderRadius: j === 0 ? 6 : 4,
                        border: '1px solid rgba(0,0,0,0.08)',
                        marginBottom: j === 0 ? 0 : 5,
                        flexShrink: 0,
                      }}
                    />
                  ))}
                </div>
                {/* 文字 */}
                <div className="flex-1">
                  <p className="text-sm text-text-primary font-medium leading-none mb-1">
                    {theme.emoji} {theme.label}
                  </p>
                  <p className="text-xs text-text-muted">{theme.desc}</p>
                </div>
                {/* 选中标记 */}
                {isActive && (
                  <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17 4 12"/>
                    </svg>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
