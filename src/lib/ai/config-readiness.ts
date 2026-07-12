import type { AIConfig, AIProvider } from '../types'

const EMPTY_KEY_COMPATIBLE_PROVIDERS = new Set<AIProvider>(['ollama', 'custom'])
const AI_CONFIG_REQUIRED_EVENT = 'storyforge:ai-config-required'

export function aiProviderAllowsEmptyKey(provider: AIProvider): boolean {
  return EMPTY_KEY_COMPATIBLE_PROVIDERS.has(provider)
}

export function isAIConfigReady(config: Pick<AIConfig, 'apiKey' | 'provider'>): boolean {
  return Boolean(config.apiKey || aiProviderAllowsEmptyKey(config.provider))
}

export function getAIConfigRequiredMessage(config: Pick<AIConfig, 'provider'>): string {
  return aiProviderAllowsEmptyKey(config.provider)
    ? '请先在「设置」中配置模型服务地址和模型名称。'
    : '请先在「设置」中配置 AI API Key。'
}

/**
 * AI 入口统一调用此方法。未配置模型时通知工作区跳转到设置页。
 */
export function requestAIConfigSetup(config: Pick<AIConfig, 'apiKey' | 'provider'>): boolean {
  if (isAIConfigReady(config)) return true
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AI_CONFIG_REQUIRED_EVENT))
  }
  return false
}

export function subscribeAIConfigRequired(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(AI_CONFIG_REQUIRED_EVENT, listener)
  return () => window.removeEventListener(AI_CONFIG_REQUIRED_EVENT, listener)
}
