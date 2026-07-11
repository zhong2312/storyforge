import { describe, expect, it } from 'vitest'
import {
  buildGenericDevProxyEndpoint,
  buildOpenAIEndpoint,
  normalizeOpenAIBaseUrl,
} from '../../src/lib/ai/openai-endpoint'

describe('R-CF20260702-ai-config-endpoint', () => {
  it('把常见误填端点修正为 OpenAI 兼容根路径', () => {
    expect(normalizeOpenAIBaseUrl('http://192.168.110.51:1234/v1/models').baseUrl)
      .toBe('http://192.168.110.51:1234/v1')
    expect(normalizeOpenAIBaseUrl('http://192.168.110.51:1234/v1/chat/completions').baseUrl)
      .toBe('http://192.168.110.51:1234/v1')
    expect(normalizeOpenAIBaseUrl('http://localhost:11434/v1/v1').baseUrl)
      .toBe('http://localhost:11434/v1')
  })

  it('开发环境下仍会基于根路径正确拼接 chat/completions', () => {
    expect(buildOpenAIEndpoint('http://x:1234/v1/chat/completions', 'chat/completions'))
      .toBe('/openai-compatible-proxy/chat/completions?baseUrl=http%3A%2F%2Fx%3A1234%2Fv1')
    expect(buildOpenAIEndpoint('http://x:1234/v1/models', 'chat/completions'))
      .toBe('/openai-compatible-proxy/chat/completions?baseUrl=http%3A%2F%2Fx%3A1234%2Fv1')
  })

  it('开发环境下任意绝对地址都可转为通用本地代理', () => {
    expect(buildGenericDevProxyEndpoint('http://localhost:1234/v1', 'chat/completions'))
      .toBe('/openai-compatible-proxy/chat/completions?baseUrl=http%3A%2F%2Flocalhost%3A1234%2Fv1')
    expect(buildOpenAIEndpoint('http://localhost:1234/v1', 'chat/completions', { provider: 'custom' }))
      .toBe('/openai-compatible-proxy/chat/completions?baseUrl=http%3A%2F%2Flocalhost%3A1234%2Fv1')
    expect(buildOpenAIEndpoint('https://ark.cn-beijing.volces.com/api/coding/v3', 'chat/completions', { provider: 'doubao' }))
      .toBe('/openai-compatible-proxy/chat/completions?baseUrl=https%3A%2F%2Fark.cn-beijing.volces.com%2Fapi%2Fcoding%2Fv3')
  })
})
