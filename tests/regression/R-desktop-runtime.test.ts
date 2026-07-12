import { describe, expect, it } from 'vitest'
import {
  isStoryForgeDesktopLocation,
  storyForgeDesktopProxyOrigin,
  storyForgeRouterBasename,
} from '../../src/lib/desktop-runtime'

describe('R-DESKTOP-RUNTIME · Wails 桌面运行时边界', () => {
  it('桌面端使用根路由和本机同进程代理', () => {
    const location = { hostname: 'wails.localhost', protocol: 'wails:', pathname: '/' }
    expect(isStoryForgeDesktopLocation(location)).toBe(true)
    expect(storyForgeRouterBasename(location)).toBe('/')
    expect(storyForgeDesktopProxyOrigin(location)).toBe('http://127.0.0.1:17831')
  })

  it('Web/PWA 保持 /storyforge 路由且不使用桌面代理源', () => {
    const location = { hostname: 'storyforge.example.com', protocol: 'https:', pathname: '/storyforge/' }
    expect(isStoryForgeDesktopLocation(location)).toBe(false)
    expect(storyForgeRouterBasename(location)).toBe('/storyforge')
    expect(storyForgeDesktopProxyOrigin(location)).toBe('')
  })
})
