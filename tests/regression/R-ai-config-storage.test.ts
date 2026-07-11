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

  it('多供应商 API Key 在会话模式下不写入 localStorage', async () => {
    const useAIConfigStore = await freshStore()
    useAIConfigStore.getState().setConfig({ apiKey: 'sk-private' })

    const catalog = JSON.parse(localStorage.getItem(CATALOG_KEY) || '{}')
    expect(catalog.providers[0].apiKey).toBe('')
    expect(sessionStorage.getItem('storyforge-ai-model-catalog-session-keys')).toContain('sk-private')
  })
})
