import { create } from 'zustand'
import type {
  AIConfig,
  AIProvider,
  AIConfigPreset,
  EmbeddingConfig,
  AIProviderConfig,
  AIModelEntry,
  AIModelRef,
  AIModelScene,
  AIModelSceneBindings,
} from '../lib/types'
import { PROVIDER_PRESETS } from '../lib/types'
import { createLog, updateLog } from '../lib/ai/logger'
import { nanoid } from '../lib/utils/id'
import { buildOpenAIEndpoint, normalizeOpenAIBaseUrl } from '../lib/ai/openai-endpoint'

const STORAGE_KEY = 'storyforge-ai-config'
const PRESETS_KEY = 'storyforge-ai-presets'
const SESSION_API_KEY = 'storyforge-ai-api-key-session'
const REMEMBER_API_KEY = 'storyforge-ai-api-key-remember'
const PORTABLE_KEY_MIGRATION = 'storyforge-ai-portable-key-migration-v1'
const EMBEDDING_KEY = 'storyforge-embedding-config'
const EMBEDDING_SESSION_KEY = 'storyforge-embedding-key-session'
const MODEL_CATALOG_KEY = 'storyforge-ai-model-catalog-v1'
const MODEL_CATALOG_SESSION_KEYS = 'storyforge-ai-model-catalog-session-keys'

interface RuntimeLocation {
  hostname?: string
  port?: string
  pathname?: string
}

export function isStoryForgePortableLocation(
  runtimeLocation: RuntimeLocation | undefined = globalThis.location,
): boolean {
  if (!runtimeLocation) return false
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(runtimeLocation.hostname || '')
    && runtimeLocation.port === '17831'
    && (runtimeLocation.pathname || '').startsWith('/storyforge')
}

const DEFAULT_CONFIG: AIConfig = {
  provider: 'deepseek',
  apiKey: '',
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com/v1',
  temperature: 0.7,
  maxTokens: 0,
  contextCompressionThreshold: 0.8,
}

/** NS-5 默认：关闭；隐私首选本地 Ollama + bge-m3（手稿不出本机）。 */
const DEFAULT_EMBEDDING: EmbeddingConfig = {
  enabled: false,
  provider: 'ollama',
  apiKey: '',
  baseUrl: 'http://localhost:11434/v1',
  model: 'bge-m3',
}

/** embedding 配置加载：key 复用与聊天 key 相同的「记住」开关（不记住→sessionStorage）。 */
function loadEmbeddingConfig(rememberApiKey: boolean): EmbeddingConfig {
  let saved: Partial<EmbeddingConfig> = {}
  try { const raw = localStorage.getItem(EMBEDDING_KEY); if (raw) saved = JSON.parse(raw) } catch { /* ignore */ }
  const sessionKey = sessionStorage.getItem(EMBEDDING_SESSION_KEY) || ''
  return { ...DEFAULT_EMBEDDING, ...saved, apiKey: rememberApiKey ? (saved.apiKey || '') : sessionKey }
}

function persistEmbeddingConfig(cfg: EmbeddingConfig, rememberApiKey: boolean): void {
  const persisted: EmbeddingConfig = rememberApiKey ? cfg : { ...cfg, apiKey: '' }
  localStorage.setItem(EMBEDDING_KEY, JSON.stringify(persisted))
  if (rememberApiKey) sessionStorage.removeItem(EMBEDDING_SESSION_KEY)
  else if (cfg.apiKey) sessionStorage.setItem(EMBEDDING_SESSION_KEY, cfg.apiKey)
  else sessionStorage.removeItem(EMBEDDING_SESSION_KEY)
}

/** 从 localStorage 加载预设列表 */
function loadPresets(): AIConfigPreset[] {
  try {
    const saved = localStorage.getItem(PRESETS_KEY)
    if (saved) {
      const arr = JSON.parse(saved)
      if (Array.isArray(arr)) return arr
    }
  } catch { /* ignore */ }
  return []
}

function savePresets(presets: AIConfigPreset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
}

interface AIModelCatalogState {
  providers: AIProviderConfig[]
  bindings: AIModelSceneBindings
  active: AIModelRef
}

function modelEntryFromConfig(config: AIConfig, id: string, name = config.model): AIModelEntry {
  return {
    id,
    name,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    contextWindow: config.contextWindow,
    contextCompressionThreshold: config.contextCompressionThreshold,
  }
}

function migrateLegacyCatalog(config: AIConfig, presets: AIConfigPreset[]): AIModelCatalogState {
  const configs = [{ name: '默认供应商', config }, ...presets.map(preset => ({ name: preset.name, config: preset.config }))]
  const providers: AIProviderConfig[] = []
  for (const item of configs) {
    const key = `${item.config.provider}\n${item.config.baseUrl}`
    let provider = providers.find(candidate => `${candidate.provider}\n${candidate.baseUrl}` === key)
    if (!provider) {
      provider = {
        id: `legacy-provider-${providers.length + 1}`,
        name: item.name,
        provider: item.config.provider,
        apiKey: item.config.apiKey,
        baseUrl: item.config.baseUrl,
        models: [],
      }
      providers.push(provider)
    }
    if (!provider.models.some(model => model.model === item.config.model)) {
      provider.models.push(modelEntryFromConfig(item.config, `legacy-model-${providers.length}-${provider.models.length + 1}`))
    }
  }
  const activeProvider = providers[0]
  const active = { providerConfigId: activeProvider.id, modelId: activeProvider.models[0].id }
  return { providers, bindings: {}, active }
}

function loadModelCatalog(
  fallback: AIConfig,
  rememberApiKey: boolean,
  presets: AIConfigPreset[],
): AIModelCatalogState {
  let raw: Partial<AIModelCatalogState> | undefined
  try {
    const saved = localStorage.getItem(MODEL_CATALOG_KEY)
    if (saved) raw = JSON.parse(saved)
  } catch { /* ignore */ }
  const providers = Array.isArray(raw?.providers)
    ? raw.providers.filter(provider => provider && Array.isArray(provider.models) && provider.models.length > 0)
    : []
  if (providers.length === 0) return migrateLegacyCatalog(fallback, presets)

  let sessionKeys: Record<string, string> = {}
  try { sessionKeys = JSON.parse(sessionStorage.getItem(MODEL_CATALOG_SESSION_KEYS) || '{}') } catch { /* ignore */ }
  const hydrated = providers.map(provider => ({
    ...provider,
    apiKey: rememberApiKey
      ? (provider.apiKey || (provider.provider === fallback.provider && provider.baseUrl === fallback.baseUrl ? fallback.apiKey : ''))
      : (sessionKeys[provider.id] || (provider.provider === fallback.provider && provider.baseUrl === fallback.baseUrl ? fallback.apiKey : '')),
  }))
  const requested = raw?.active
  const activeProvider = hydrated.find(provider => provider.id === requested?.providerConfigId) ?? hydrated[0]
  const activeModel = activeProvider.models.find(model => model.id === requested?.modelId) ?? activeProvider.models[0]
  return {
    providers: hydrated,
    bindings: raw?.bindings ?? {},
    active: { providerConfigId: activeProvider.id, modelId: activeModel.id },
  }
}

function persistModelCatalog(catalog: AIModelCatalogState, rememberApiKey: boolean): void {
  const persisted = {
    ...catalog,
    providers: catalog.providers.map(provider => rememberApiKey ? provider : { ...provider, apiKey: '' }),
  }
  localStorage.setItem(MODEL_CATALOG_KEY, JSON.stringify(persisted))
  if (rememberApiKey) {
    sessionStorage.removeItem(MODEL_CATALOG_SESSION_KEYS)
  } else {
    sessionStorage.setItem(MODEL_CATALOG_SESSION_KEYS, JSON.stringify(Object.fromEntries(
      catalog.providers.filter(provider => provider.apiKey).map(provider => [provider.id, provider.apiKey]),
    )))
  }
}

function resolveCatalogConfig(catalog: AIModelCatalogState, ref: AIModelRef | undefined): AIConfig {
  const fallbackProvider = catalog.providers.find(provider => provider.id === catalog.active.providerConfigId)
    ?? catalog.providers[0]
  const provider = catalog.providers.find(candidate => candidate.id === ref?.providerConfigId) ?? fallbackProvider
  const fallbackModel = provider.models.find(model => model.id === catalog.active.modelId) ?? provider.models[0]
  const model = provider.models.find(candidate => candidate.id === ref?.modelId) ?? fallbackModel
  return {
    provider: provider.provider,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    model: model.model,
    temperature: model.temperature,
    maxTokens: model.maxTokens,
    contextWindow: model.contextWindow,
    contextCompressionThreshold: model.contextCompressionThreshold ?? 0.8,
  }
}

export function resolveAIModelConfig(
  providers: AIProviderConfig[],
  bindings: AIModelSceneBindings,
  active: AIModelRef,
  scene: AIModelScene,
  override?: AIModelRef,
): AIConfig {
  return resolveCatalogConfig(
    { providers, bindings, active },
    override ?? bindings[scene] ?? active,
  )
}

function syncActiveCatalog(catalog: AIModelCatalogState, config: AIConfig): AIModelCatalogState {
  return {
    ...catalog,
    providers: catalog.providers.map(provider => provider.id !== catalog.active.providerConfigId ? provider : {
      ...provider,
      provider: config.provider,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      models: provider.models.map(model => model.id !== catalog.active.modelId ? model : {
        ...model,
        model: config.model,
        name: model.name === model.model ? config.model : model.name,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        contextWindow: config.contextWindow,
        contextCompressionThreshold: config.contextCompressionThreshold,
      }),
    }),
  }
}

/** 根据 HTTP 状态码和英文错误信息，返回中文解释 */
function getChineseExplanation(status: number, msg: string): string {
  const lower = msg.toLowerCase()

  // 按 HTTP 状态码
  if (status === 401) return 'API Key 无效或已过期'
  if (status === 402) return '账户余额不足，请充值后使用'
  if (status === 403) return 'API Key 权限不足，无权访问该模型'
  if (status === 404) return 'API 地址或模型名称错误，请检查 Base URL 和模型名'
  if (status === 429) return '请求频率超限，请稍后再试'
  if (status === 500) return '服务器内部错误，请稍后重试'
  if (status === 502) return '网关错误，服务暂时不可用'
  if (status === 503) return '服务暂时不可用，可能正在维护'

  // 按错误信息关键词匹配
  if (lower.includes('insufficient balance') || lower.includes('insufficient_balance'))
    return '账户余额不足，请充值'
  if (lower.includes('invalid api key') || lower.includes('invalid_api_key'))
    return 'API Key 无效，请检查是否填写正确'
  if (lower.includes('authentication') || lower.includes('unauthorized'))
    return '认证失败，API Key 无效或已过期'
  if (lower.includes('rate limit') || lower.includes('rate_limit'))
    return '请求频率超限，请稍后再试'
  if (lower.includes('model not found') || lower.includes('model_not_found'))
    return '模型不存在，请检查模型名称是否正确'
  if (lower.includes('context length') || lower.includes('context_length'))
    return '输入内容超过模型最大上下文长度'
  if (lower.includes('quota exceeded') || lower.includes('quota_exceeded'))
    return '配额已用完'
  if (lower.includes('server error') || lower.includes('internal error'))
    return '服务器内部错误'
  if (lower.includes('timeout'))
    return '请求超时'
  if (lower.includes('bad request'))
    return '请求格式错误，请检查参数'
  if (lower.includes('not found'))
    return '接口不存在，请检查 Base URL'
  if (lower.includes('permission denied'))
    return '权限不足'
  if (lower.includes('billing') || lower.includes('payment'))
    return '账单/付款问题，请检查账户'
  if (lower.includes('overloaded') || lower.includes('capacity'))
    return '服务过载，请稍后重试'
  if (lower.includes('thinking') && lower.includes('budget'))
    return '思考模式参数冲突，请不要手动传 thinking 相关参数'

  return ''
}

/** 从 localStorage 加载配置 */
function loadInitialConfig(): { config: AIConfig; rememberApiKey: boolean } {
  let savedConfig: Partial<AIConfig> = {}
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) savedConfig = JSON.parse(saved)
  } catch { /* ignore */ }

  const rememberRaw = localStorage.getItem(REMEMBER_API_KEY)
  const legacyHasLocalKey = typeof savedConfig.apiKey === 'string' && savedConfig.apiKey.length > 0
  const sessionKey = sessionStorage.getItem(SESSION_API_KEY) || ''
  const migratePortableKey = isStoryForgePortableLocation()
    && localStorage.getItem(PORTABLE_KEY_MIGRATION) !== 'done'
  const rememberApiKey = migratePortableKey
    ? true
    : rememberRaw == null ? legacyHasLocalKey : rememberRaw === 'true'
  const config: AIConfig = {
    ...DEFAULT_CONFIG,
    ...savedConfig,
    apiKey: rememberApiKey ? (savedConfig.apiKey || sessionKey) : sessionKey,
  }

  if (migratePortableKey) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    localStorage.setItem(REMEMBER_API_KEY, 'true')
    localStorage.setItem(PORTABLE_KEY_MIGRATION, 'done')
    sessionStorage.removeItem(SESSION_API_KEY)
  }

  return {
    config,
    rememberApiKey,
  }
}

function persistConfig(config: AIConfig, rememberApiKey: boolean): void {
  const persisted: AIConfig = rememberApiKey ? config : { ...config, apiKey: '' }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
  localStorage.setItem(REMEMBER_API_KEY, String(rememberApiKey))
  if (rememberApiKey) {
    sessionStorage.removeItem(SESSION_API_KEY)
  } else if (config.apiKey) {
    sessionStorage.setItem(SESSION_API_KEY, config.apiKey)
  } else {
    sessionStorage.removeItem(SESSION_API_KEY)
  }
}

function presetConfig(config: AIConfig, rememberApiKey: boolean): AIConfig {
  return rememberApiKey ? { ...config } : { ...config, apiKey: '' }
}

export interface TestResult {
  ok: boolean
  message: string
  statusCode?: number
  duration?: number
}

interface AIConfigStore {
  config: AIConfig
  providerConfigs: AIProviderConfig[]
  sceneBindings: AIModelSceneBindings
  activeModelRef: AIModelRef
  rememberApiKey: boolean
  presets: AIConfigPreset[]
  /** 当前生效的预设 id（null = 未对应任何预设/已改动） */
  activePresetId: string | null
  /** 最近一次应用/保存的预设 id；表单改动后仍保留,用于显式覆盖当前预设。 */
  editingPresetId: string | null
  /** NS-5 语义检索（embedding）配置 */
  embedding: EmbeddingConfig
  setEmbeddingConfig: (partial: Partial<EmbeddingConfig>) => void
  setConfig: (config: Partial<AIConfig>) => void
  setRememberApiKey: (remember: boolean) => void
  switchProvider: (provider: AIProvider) => void
  testConnection: () => Promise<TestResult>
  addProviderConfig: (provider?: AIProvider) => string
  removeProviderConfig: (id: string) => void
  selectModel: (ref: AIModelRef) => void
  addModel: (providerConfigId: string, model: string) => string
  removeModel: (providerConfigId: string, modelId: string) => void
  renameProviderConfig: (id: string, name: string) => void
  renameModel: (providerConfigId: string, modelId: string, name: string) => void
  setSceneBinding: (scene: AIModelScene, ref: AIModelRef | null) => void
  resolveConfigForScene: (scene: AIModelScene, override?: AIModelRef) => AIConfig
  // ── 预设管理 ──
  saveAsPreset: (name: string) => string
  applyPreset: (id: string) => void
  updatePresetFromCurrent: (id: string) => void
  renamePreset: (id: string, name: string) => void
  deletePreset: (id: string) => void
}

const initial = loadInitialConfig()
const initialPresets = loadPresets()
const initialCatalog = loadModelCatalog(initial.config, initial.rememberApiKey, initialPresets)
const initialRuntimeConfig = resolveCatalogConfig(initialCatalog, initialCatalog.active)
persistModelCatalog(initialCatalog, initial.rememberApiKey)

export const useAIConfigStore = create<AIConfigStore>((set, get) => ({
  config: initialRuntimeConfig,
  providerConfigs: initialCatalog.providers,
  sceneBindings: initialCatalog.bindings,
  activeModelRef: initialCatalog.active,
  rememberApiKey: initial.rememberApiKey,
  presets: initialPresets,
  activePresetId: null,
  editingPresetId: null,
  embedding: loadEmbeddingConfig(initial.rememberApiKey),

  setEmbeddingConfig: (partial: Partial<EmbeddingConfig>) => {
    const next = { ...get().embedding, ...partial }
    persistEmbeddingConfig(next, get().rememberApiKey)
    set({ embedding: next })
  },

  setConfig: (partial: Partial<AIConfig>) => {
    const newConfig = { ...get().config, ...partial }
    const catalog = syncActiveCatalog({
      providers: get().providerConfigs,
      bindings: get().sceneBindings,
      active: get().activeModelRef,
    }, newConfig)
    persistConfig(newConfig, get().rememberApiKey)
    persistModelCatalog(catalog, get().rememberApiKey)
    // 手动改动配置后，与已选预设脱钩（除非改动等于该预设）
    set({ config: newConfig, providerConfigs: catalog.providers, activePresetId: null })
  },

  setRememberApiKey: (remember: boolean) => {
    persistConfig(get().config, remember)
    persistEmbeddingConfig(get().embedding, remember)
    persistModelCatalog({ providers: get().providerConfigs, bindings: get().sceneBindings, active: get().activeModelRef }, remember)
    set({ rememberApiKey: remember })
  },

  saveAsPreset: (name: string) => {
    const id = nanoid()
    const preset: AIConfigPreset = {
      id,
      name: name.trim() || '未命名配置',
      config: presetConfig(get().config, get().rememberApiKey),
    }
    const presets = [...get().presets, preset]
    savePresets(presets)
    set({ presets, activePresetId: id, editingPresetId: id })
    return id
  },

  applyPreset: (id: string) => {
    const preset = get().presets.find(p => p.id === id)
    if (!preset) return
    const newConfig = { ...preset.config, apiKey: preset.config.apiKey || get().config.apiKey }
    persistConfig(newConfig, get().rememberApiKey)
    set({ config: newConfig, activePresetId: id, editingPresetId: id })
  },

  updatePresetFromCurrent: (id: string) => {
    const presets = get().presets.map(p => p.id === id ? {
      ...p,
      config: presetConfig(get().config, get().rememberApiKey),
    } : p)
    savePresets(presets)
    set({ presets, activePresetId: id, editingPresetId: id })
  },

  renamePreset: (id: string, name: string) => {
    const presets = get().presets.map(p => p.id === id ? { ...p, name: name.trim() || p.name } : p)
    savePresets(presets)
    set({ presets })
  },

  deletePreset: (id: string) => {
    const presets = get().presets.filter(p => p.id !== id)
    savePresets(presets)
    set({
      presets,
      activePresetId: get().activePresetId === id ? null : get().activePresetId,
      editingPresetId: get().editingPresetId === id ? null : get().editingPresetId,
    })
  },

  switchProvider: (provider: AIProvider) => {
    const preset = PROVIDER_PRESETS[provider] || {}
    const newConfig: AIConfig = {
      ...get().config,
      provider,
      ...preset,
      apiKey: provider === get().config.provider ? get().config.apiKey : (preset.apiKey || ''),
    }
    persistConfig(newConfig, get().rememberApiKey)
    const catalog = syncActiveCatalog({ providers: get().providerConfigs, bindings: get().sceneBindings, active: get().activeModelRef }, newConfig)
    persistModelCatalog(catalog, get().rememberApiKey)
    set({ config: newConfig, providerConfigs: catalog.providers, activePresetId: null, editingPresetId: null })
  },

  addProviderConfig: (provider = 'custom') => {
    const preset = PROVIDER_PRESETS[provider] ?? {}
    const providerId = nanoid()
    const modelId = nanoid()
    const base: AIConfig = {
      ...DEFAULT_CONFIG,
      provider,
      ...preset,
      apiKey: '',
    }
    const entry: AIProviderConfig = {
      id: providerId,
      name: `${provider} ${get().providerConfigs.length + 1}`,
      provider,
      apiKey: base.apiKey,
      baseUrl: base.baseUrl,
      models: [modelEntryFromConfig(base, modelId)],
    }
    const catalog = {
      providers: [...get().providerConfigs, entry],
      bindings: get().sceneBindings,
      active: { providerConfigId: providerId, modelId },
    }
    persistModelCatalog(catalog, get().rememberApiKey)
    persistConfig(base, get().rememberApiKey)
    set({ providerConfigs: catalog.providers, activeModelRef: catalog.active, config: base })
    return providerId
  },

  removeProviderConfig: (id) => {
    if (get().providerConfigs.length <= 1) return
    const providers = get().providerConfigs.filter(provider => provider.id !== id)
    const fallback = providers[0]
    const active = get().activeModelRef.providerConfigId === id
      ? { providerConfigId: fallback.id, modelId: fallback.models[0].id }
      : get().activeModelRef
    const bindings = Object.fromEntries(Object.entries(get().sceneBindings).filter(([, ref]) => ref?.providerConfigId !== id)) as AIModelSceneBindings
    const catalog = { providers, bindings, active }
    const config = resolveCatalogConfig(catalog, active)
    persistModelCatalog(catalog, get().rememberApiKey)
    persistConfig(config, get().rememberApiKey)
    set({ providerConfigs: providers, sceneBindings: bindings, activeModelRef: active, config })
  },

  selectModel: (ref) => {
    const catalog = { providers: get().providerConfigs, bindings: get().sceneBindings, active: ref }
    const config = resolveCatalogConfig(catalog, ref)
    persistModelCatalog(catalog, get().rememberApiKey)
    persistConfig(config, get().rememberApiKey)
    set({ activeModelRef: ref, config })
  },

  addModel: (providerConfigId, modelName) => {
    const modelId = nanoid()
    const model = modelName.trim() || 'new-model'
    const providers = get().providerConfigs.map(provider => provider.id !== providerConfigId ? provider : {
      ...provider,
      models: [...provider.models, modelEntryFromConfig({ ...get().config, provider: provider.provider, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model }, modelId)],
    })
    const active = { providerConfigId, modelId }
    const catalog = { providers, bindings: get().sceneBindings, active }
    const config = resolveCatalogConfig(catalog, active)
    persistModelCatalog(catalog, get().rememberApiKey)
    persistConfig(config, get().rememberApiKey)
    set({ providerConfigs: providers, activeModelRef: active, config })
    return modelId
  },

  removeModel: (providerConfigId, modelId) => {
    const provider = get().providerConfigs.find(item => item.id === providerConfigId)
    if (!provider || provider.models.length <= 1) return
    const providers = get().providerConfigs.map(item => item.id !== providerConfigId ? item : {
      ...item,
      models: item.models.filter(model => model.id !== modelId),
    })
    const fallbackModel = providers.find(item => item.id === providerConfigId)!.models[0]
    const active = get().activeModelRef.modelId === modelId
      ? { providerConfigId, modelId: fallbackModel.id }
      : get().activeModelRef
    const bindings = Object.fromEntries(Object.entries(get().sceneBindings).filter(([, ref]) => ref?.modelId !== modelId)) as AIModelSceneBindings
    const catalog = { providers, bindings, active }
    const config = resolveCatalogConfig(catalog, active)
    persistModelCatalog(catalog, get().rememberApiKey)
    persistConfig(config, get().rememberApiKey)
    set({ providerConfigs: providers, sceneBindings: bindings, activeModelRef: active, config })
  },

  renameProviderConfig: (id, name) => {
    const providers = get().providerConfigs.map(provider => provider.id === id ? { ...provider, name: name.trim() || provider.name } : provider)
    persistModelCatalog({ providers, bindings: get().sceneBindings, active: get().activeModelRef }, get().rememberApiKey)
    set({ providerConfigs: providers })
  },

  renameModel: (providerConfigId, modelId, name) => {
    const providers = get().providerConfigs.map(provider => provider.id !== providerConfigId ? provider : {
      ...provider,
      models: provider.models.map(model => model.id === modelId ? { ...model, name: name.trim() || model.model } : model),
    })
    persistModelCatalog({ providers, bindings: get().sceneBindings, active: get().activeModelRef }, get().rememberApiKey)
    set({ providerConfigs: providers })
  },

  setSceneBinding: (scene, ref) => {
    const bindings = { ...get().sceneBindings }
    if (ref) bindings[scene] = ref
    else delete bindings[scene]
    persistModelCatalog({ providers: get().providerConfigs, bindings, active: get().activeModelRef }, get().rememberApiKey)
    set({ sceneBindings: bindings })
  },

  resolveConfigForScene: (scene, override) => resolveAIModelConfig(
    get().providerConfigs,
    get().sceneBindings,
    get().activeModelRef,
    scene,
    override,
  ),

  testConnection: async (): Promise<TestResult> => {
    const { config } = get()
    const normalized = normalizeOpenAIBaseUrl(config.baseUrl)
    if (normalized.changed) {
      const newConfig = { ...config, baseUrl: normalized.baseUrl }
      persistConfig(newConfig, get().rememberApiKey)
      set({ config: newConfig, activePresetId: null })
    }
    const url = buildOpenAIEndpoint(normalized.baseUrl, 'chat/completions', { provider: config.provider })
    const startTime = Date.now()
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 15_000)

    // 创建日志
    const log = createLog({
      type: 'test',
      provider: config.provider,
      url,
      model: config.model,
      status: 'pending',
    })

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: '请回复"连接成功"' }],
        }),
      })

      const duration = Date.now() - startTime
      const bodyText = await response.text()

      if (response.ok) {
        updateLog(log.id, { status: 'success', statusCode: response.status, duration, responseBody: bodyText.slice(0, 200) })
        const prefix = normalized.warnings.length ? `${normalized.warnings.join(' ')} ` : ''
        return { ok: true, message: `✅ ${prefix}连接成功`, statusCode: response.status, duration }
      }

      // 解析错误信息
      let rawErrorMsg = `HTTP ${response.status}`
      try {
        const errJson = JSON.parse(bodyText)
        if (errJson.error?.message) rawErrorMsg = errJson.error.message
        else if (errJson.message) rawErrorMsg = errJson.message
        else if (errJson.error_msg) rawErrorMsg = errJson.error_msg
      } catch {
        if (bodyText.length < 200) rawErrorMsg += ': ' + bodyText
      }

      // 常见英文错误 → 中文翻译映射
      const cnExplanation = getChineseExplanation(response.status, rawErrorMsg)

      // HTTP 402 = 余额不足，但说明连接和认证都成功了
      if (response.status === 402) {
        const msg = `${rawErrorMsg}（${cnExplanation}）`
        updateLog(log.id, { status: 'success', statusCode: response.status, duration, responseBody: bodyText.slice(0, 200) })
        const prefix = normalized.warnings.length ? `${normalized.warnings.join(' ')} ` : ''
        return { ok: true, message: `✅ ${prefix}连接成功 — ${msg}`, statusCode: response.status, duration }
      }

      const urlHint = normalized.warnings.length
        ? `；${normalized.warnings.join(' ')}`
        : ''
      const localHint = ['custom', 'ollama'].includes(config.provider)
        ? '；本地 OpenAI 兼容服务的 Base URL 通常应填到 /v1，例如 LM Studio: http://主机:1234/v1，Ollama: http://localhost:11434/v1'
        : ''
      const errorMsg = `${cnExplanation ? `${rawErrorMsg}（${cnExplanation}）` : rawErrorMsg}${urlHint}${localHint}`

      updateLog(log.id, { status: 'error', statusCode: response.status, duration, errorMessage: errorMsg, responseBody: bodyText.slice(0, 500) })
      return { ok: false, message: `❌ ${errorMsg}`, statusCode: response.status, duration }

    } catch (err: unknown) {
      const duration = Date.now() - startTime
      const error = err as Error
      let errorMsg: string

      if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
        errorMsg = url.startsWith('/openai-compatible-proxy/')
          ? '本地 AI 代理请求失败 — 请确认当前页面由 StoryForge Portable 启动，且 17831 端口未被旧进程占用'
          : '网络错误 — 可能原因：1) 网络不通 2) 该平台不支持浏览器直接调用(CORS) 3) Base URL 错误'
      } else if (error.name === 'AbortError') {
        errorMsg = '请求超时'
      } else {
        errorMsg = error.message || '未知错误'
      }

      updateLog(log.id, { status: 'error', duration, errorMessage: errorMsg })
      return { ok: false, message: `❌ ${errorMsg}`, duration }
    } finally {
      window.clearTimeout(timeoutId)
    }
  },
}))
