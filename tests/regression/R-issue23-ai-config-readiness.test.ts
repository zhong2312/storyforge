import { describe, expect, it } from 'vitest'
import {
  aiProviderAllowsEmptyKey,
  isAIConfigReady,
  requestAIConfigSetup,
  subscribeAIConfigRequired,
} from '../../src/lib/ai/config-readiness'
import type { AIConfig } from '../../src/lib/types'

function cfg(provider: AIConfig['provider'], apiKey = ''): AIConfig {
  return {
    provider,
    apiKey,
    model: 'test-model',
    baseUrl: 'http://localhost:11434/v1',
    temperature: 0.7,
    maxTokens: 0,
  }
}

describe('Issue #23 · local/custom OpenAI-compatible services can run without API key', () => {
  it('allows Ollama and custom-compatible services to skip local preflight key blocking', () => {
    expect(aiProviderAllowsEmptyKey('ollama')).toBe(true)
    expect(aiProviderAllowsEmptyKey('custom')).toBe(true)
    expect(isAIConfigReady(cfg('ollama'))).toBe(true)
    expect(isAIConfigReady(cfg('custom'))).toBe(true)
  })

  it('still requires API keys for hosted providers before request time', () => {
    expect(isAIConfigReady(cfg('deepseek'))).toBe(false)
    expect(isAIConfigReady(cfg('openai', 'sk-test'))).toBe(true)
  })

  it('notifies the workspace to open settings before an unconfigured AI action runs', () => {
    let notifications = 0
    const unsubscribe = subscribeAIConfigRequired(() => { notifications += 1 })

    expect(requestAIConfigSetup(cfg('deepseek'))).toBe(false)
    expect(notifications).toBe(1)
    expect(requestAIConfigSetup(cfg('ollama'))).toBe(true)
    expect(notifications).toBe(1)

    unsubscribe()
  })
})
