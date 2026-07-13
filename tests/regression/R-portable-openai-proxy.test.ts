import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildOpenAIEndpoint,
  normalizeOpenAIBaseUrl,
} from '../../src/lib/ai/openai-endpoint'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('R-PORTABLE-PROXY · 本地生产包模型代理', () => {
  it('本机地址通过同源代理访问绝对 Base URL', () => {
    vi.stubGlobal('window', { location: { hostname: '127.0.0.1' } })

    expect(buildOpenAIEndpoint(
      'https://ark.cn-beijing.volces.com/api/coding/v3',
      'chat/completions',
    )).toBe(
      '/openai-compatible-proxy/chat/completions?baseUrl=' +
      'https%3A%2F%2Fark.cn-beijing.volces.com%2Fapi%2Fcoding%2Fv3',
    )
  })

  it('线上地址保持直连,不把用户密钥转发给部署站点', () => {
    vi.stubGlobal('window', { location: { hostname: 'storyforge.example.com' } })

    expect(buildOpenAIEndpoint('https://api.example.com/v1', 'models'))
      .toBe('https://api.example.com/v1/models')
  })

  it('Wails 桌面端通过同进程流式代理访问模型服务', () => {
    vi.stubGlobal('window', { location: { hostname: 'wails.localhost', protocol: 'wails:' } })

    expect(buildOpenAIEndpoint('https://api.example.com/v1', 'chat/completions'))
      .toBe(
        'http://127.0.0.1:17831/openai-compatible-proxy/chat/completions?' +
        'baseUrl=https%3A%2F%2Fapi.example.com%2Fv1',
      )
  })

  it('继续修正常见的重复端点和重复 v1', () => {
    expect(normalizeOpenAIBaseUrl('https://api.example.com/v1/v1/chat/completions').baseUrl)
      .toBe('https://api.example.com/v1')
  })
})
