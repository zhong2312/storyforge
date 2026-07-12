import { afterEach, describe, expect, it, vi } from 'vitest'
import { getModelPreset } from '../../src/lib/ai/context-budget'
import { PROVIDER_MODELS, PROVIDER_PRESETS } from '../../src/lib/types'

const CONFIG_KEY = 'storyforge-ai-config'
const SESSION_KEY = 'storyforge-ai-api-key-session'
const REMEMBER_KEY = 'storyforge-ai-api-key-remember'
const PORTABLE_MIGRATION_KEY = 'storyforge-ai-portable-key-migration-v1'
const CATALOG_KEY = 'storyforge-ai-model-catalog-v1'

async function freshStore() {
  vi.resetModules()
  const mod = await import('../../src/stores/ai-config')
  return mod.useAIConfigStore
}

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('R-AI-CONFIG · API Key 存储策略', () => {
  it('默认只把 API Key 存入 sessionStorage,localStorage 配置不落 key', async () => {
    const useAIConfigStore = await freshStore()
    expect(useAIConfigStore.getState().config.contextCompressionThreshold).toBe(0.8)
    useAIConfigStore.getState().setConfig({ apiKey: 'sk-session' })

    expect(useAIConfigStore.getState().rememberApiKey).toBe(false)
    expect(sessionStorage.getItem(SESSION_KEY)).toBe('sk-session')
    expect(JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}').apiKey).toBe('')
    expect(localStorage.getItem(REMEMBER_KEY)).toBe('false')
  })

  it('显式记住本机时才把 API Key 写入 localStorage', async () => {
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setRememberApiKey(true)
    useAIConfigStore.getState().setConfig({ apiKey: 'sk-local' })

    expect(useAIConfigStore.getState().rememberApiKey).toBe(true)
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
    expect(JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}').apiKey).toBe('sk-local')
    expect(localStorage.getItem(REMEMBER_KEY)).toBe('true')
  })

  it('Portable 首次升级时把会话 Key 迁移为独立配置目录中的持久 Key', async () => {
    sessionStorage.setItem(SESSION_KEY, 'sk-portable-session')
    vi.stubGlobal('location', {
      hostname: '127.0.0.1',
      port: '17831',
      pathname: '/storyforge/settings',
    })

    const useAIConfigStore = await freshStore()

    expect(useAIConfigStore.getState().rememberApiKey).toBe(true)
    expect(useAIConfigStore.getState().config.apiKey).toBe('sk-portable-session')
    expect(JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}').apiKey).toBe('sk-portable-session')
    expect(localStorage.getItem(REMEMBER_KEY)).toBe('true')
    expect(localStorage.getItem(PORTABLE_MIGRATION_KEY)).toBe('done')
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('Wails WebView2 桌面环境使用 Portable 持久化策略', async () => {
    vi.stubGlobal('location', {
      hostname: 'wails.localhost',
      protocol: 'wails:',
      pathname: '/',
    })
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setConfig({ apiKey: 'sk-desktop' })

    expect(useAIConfigStore.getState().rememberApiKey).toBe(true)
    expect(JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}').apiKey).toBe('sk-desktop')
  })

  it('兼容旧版 localStorage 配置:已有 apiKey 初始化为已记住状态', async () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      provider: 'deepseek',
      apiKey: 'sk-legacy',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      temperature: 0.7,
      maxTokens: 0,
    }))

    const useAIConfigStore = await freshStore()

    expect(useAIConfigStore.getState().rememberApiKey).toBe(true)
    expect(useAIConfigStore.getState().config.apiKey).toBe('sk-legacy')
  })

  it('session-only 模式保存预设时不把当前 API Key 写进预设 localStorage', async () => {
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setConfig({ apiKey: 'sk-session' })
    useAIConfigStore.getState().saveAsPreset('会话预设')

    const presets = JSON.parse(localStorage.getItem('storyforge-ai-presets') || '[]')
    expect(presets[0].config.apiKey).toBe('')
  })

  it('应用预设后修改配置仍保留可覆盖的来源预设', async () => {
    const useAIConfigStore = await freshStore()
    const id = useAIConfigStore.getState().saveAsPreset('主力配置')
    useAIConfigStore.getState().applyPreset(id)
    useAIConfigStore.getState().setConfig({ baseUrl: 'https://example.com/v1', model: 'new-model' })

    expect(useAIConfigStore.getState().activePresetId).toBeNull()
    expect(useAIConfigStore.getState().editingPresetId).toBe(id)

    useAIConfigStore.getState().updatePresetFromCurrent(id)
    const preset = useAIConfigStore.getState().presets.find(p => p.id === id)
    expect(preset?.config.baseUrl).toBe('https://example.com/v1')
    expect(preset?.config.model).toBe('new-model')
    expect(useAIConfigStore.getState().activePresetId).toBe(id)
  })

  it('LongCat provider 使用官方 OpenAI 兼容端点和 1M 上下文预设', async () => {
    expect(PROVIDER_PRESETS.longcat?.baseUrl).toBe('https://api.longcat.chat/openai/v1')
    expect(PROVIDER_PRESETS.longcat?.model).toBe('LongCat-2.0')
    expect(PROVIDER_MODELS.longcat?.[0]?.value).toBe('LongCat-2.0')

    const preset = getModelPreset('longcat', 'LongCat-2.0')
    expect(preset.maxContext).toBe(1_000_000)
    expect(preset.maxOutput).toBe(128_000)

    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().switchProvider('longcat')
    expect(useAIConfigStore.getState().config.baseUrl).toBe('https://api.longcat.chat/openai/v1')
    expect(useAIConfigStore.getState().config.model).toBe('LongCat-2.0')
  })

  it('把旧单模型配置无损迁移为供应商目录', async () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      provider: 'openai', apiKey: 'sk-old', baseUrl: 'https://example.com/v1',
      model: 'writer-v1', temperature: 0.4, maxTokens: 8192, contextWindow: 128000,
    }))

    const useAIConfigStore = await freshStore()
    const state = useAIConfigStore.getState()
    expect(state.providerConfigs).toHaveLength(1)
    expect(state.providerConfigs[0]).toMatchObject({
      provider: 'openai', baseUrl: 'https://example.com/v1', apiKey: 'sk-old',
      models: [{ model: 'writer-v1', contextWindow: 128000 }],
    })
    expect(JSON.parse(localStorage.getItem(CATALOG_KEY) || '{}').providers).toHaveLength(1)
  })

  it('迁移旧预设时保留同模型的不同参数和预设名称', async () => {
    const base = {
      provider: 'openai', apiKey: 'sk-old', baseUrl: 'https://example.com/v1',
      model: 'writer-v1', temperature: 0.4, maxTokens: 4096, contextWindow: 64000,
    }
    localStorage.setItem(CONFIG_KEY, JSON.stringify(base))
    localStorage.setItem('storyforge-ai-presets', JSON.stringify([
      { id: 'a', name: '长篇正文', config: { ...base, temperature: 0.7, maxTokens: 12000 } },
      { id: 'b', name: '精修模式', config: { ...base, temperature: 0.2, maxTokens: 6000 } },
    ]))

    const useAIConfigStore = await freshStore()
    expect(useAIConfigStore.getState().providerConfigs.map(provider => provider.name))
      .toEqual(['默认供应商', '长篇正文', '精修模式'])
    expect(useAIConfigStore.getState().providerConfigs.map(provider => provider.models[0].temperature))
      .toEqual([0.4, 0.7, 0.2])
  })

  it('测试连接归一化 Base URL 后同步模型目录并可跨重载保留', async () => {
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setConfig({ baseUrl: 'https://api.deepseek.com/v1/chat/completions' })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '连接成功' } }] }),
      json: async () => ({ choices: [{ message: { content: '连接成功' } }] }),
    })))

    expect((await useAIConfigStore.getState().testConnection()).ok).toBe(true)
    const normalized = useAIConfigStore.getState().config.baseUrl
    expect(useAIConfigStore.getState().resolveConfigForScene('chat').baseUrl).toBe(normalized)

    const reloaded = await freshStore()
    expect(reloaded.getState().resolveConfigForScene('chat').baseUrl).toBe(normalized)
  })

  it('支持多个供应商、多个模型及五类场景绑定', async () => {
    const useAIConfigStore = await freshStore()
    const secondProviderId = useAIConfigStore.getState().addProviderConfig('openai')
    useAIConfigStore.getState().setConfig({ apiKey: 'sk-openai', baseUrl: 'https://api.openai.com/v1' })
    const secondModelId = useAIConfigStore.getState().addModel(secondProviderId, 'gpt-writing')
    useAIConfigStore.getState().setSceneBinding('chapter', {
      providerConfigId: secondProviderId,
      modelId: secondModelId,
    })

    const state = useAIConfigStore.getState()
    expect(state.providerConfigs).toHaveLength(2)
    expect(state.providerConfigs.find(provider => provider.id === secondProviderId)?.models).toHaveLength(2)
    expect(state.resolveConfigForScene('chapter')).toMatchObject({
      provider: 'openai', model: 'gpt-writing', apiKey: 'sk-openai',
    })
    expect(state.resolveConfigForScene('outline').model).toBe(state.config.model)
  })

  it('压缩阈值为目录全局配置，切换模型后保持不变', async () => {
    const useAIConfigStore = await freshStore()
    const providerId = useAIConfigStore.getState().activeModelRef.providerConfigId
    const secondModelId = useAIConfigStore.getState().addModel(providerId, 'writer-long-context')
    useAIConfigStore.getState().setContextCompressionThreshold(0.7)
    const firstModelId = useAIConfigStore.getState().providerConfigs[0].models[0].id

    useAIConfigStore.getState().selectModel({ providerConfigId: providerId, modelId: firstModelId })
    expect(useAIConfigStore.getState().contextCompressionThreshold).toBe(0.7)
    expect(useAIConfigStore.getState().config.contextCompressionThreshold).toBe(0.7)

    const catalog = JSON.parse(localStorage.getItem(CATALOG_KEY) || '{}')
    expect(catalog.contextCompressionThreshold).toBe(0.7)
    expect(catalog.providers[0].models.find((model: { id: string }) => model.id === secondModelId))
      .not.toHaveProperty('contextCompressionThreshold')
  })

  it('把旧模型级压缩阈值迁移为全局配置，并补齐供应商 API 格式', async () => {
    localStorage.setItem(CATALOG_KEY, JSON.stringify({
      providers: [{
        id: 'old-provider', name: '旧供应商', provider: 'custom', apiKey: '', baseUrl: 'https://example.com/v1',
        models: [{ id: 'old-model', name: '旧模型', model: 'writer', temperature: 0.5, maxTokens: 4096, contextCompressionThreshold: 0.65 }],
      }],
      bindings: {},
      active: { providerConfigId: 'old-provider', modelId: 'old-model' },
    }))

    const useAIConfigStore = await freshStore()
    expect(useAIConfigStore.getState().contextCompressionThreshold).toBe(0.65)
    expect(useAIConfigStore.getState().providerConfigs[0].apiFormat).toBe('openai-compatible')
    const migrated = JSON.parse(localStorage.getItem(CATALOG_KEY) || '{}')
    expect(migrated.contextCompressionThreshold).toBe(0.65)
    expect(migrated.providers[0].apiFormat).toBe('openai-compatible')
    expect(migrated.providers[0].models[0]).not.toHaveProperty('contextCompressionThreshold')
  })

  it('供应商 API 格式随目录持久化', async () => {
    const useAIConfigStore = await freshStore()
    const providerId = useAIConfigStore.getState().activeModelRef.providerConfigId
    useAIConfigStore.getState().setProviderApiFormat(providerId, 'openai-compatible')

    const catalog = JSON.parse(localStorage.getItem(CATALOG_KEY) || '{}')
    expect(catalog.providers[0].apiFormat).toBe('openai-compatible')
  })

  it('多供应商 API Key 在会话模式下不写入 localStorage', async () => {
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setConfig({ apiKey: 'sk-private' })

    const catalog = JSON.parse(localStorage.getItem(CATALOG_KEY) || '{}')
    expect(catalog.providers[0].apiKey).toBe('')
    expect(sessionStorage.getItem('storyforge-ai-model-catalog-session-keys')).toContain('sk-private')
  })
})
