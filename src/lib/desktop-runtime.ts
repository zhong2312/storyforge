export interface StoryForgeRuntimeLocation {
  hostname?: string
  port?: string
  pathname?: string
  protocol?: string
}

export function isStoryForgeDesktopLocation(
  runtimeLocation: StoryForgeRuntimeLocation | undefined = globalThis.location,
): boolean {
  if (!runtimeLocation) return false
  return runtimeLocation.protocol === 'wails:' || runtimeLocation.hostname === 'wails.localhost'
}

export function storyForgeRouterBasename(
  runtimeLocation: StoryForgeRuntimeLocation | undefined = globalThis.location,
): string {
  return isStoryForgeDesktopLocation(runtimeLocation) ? '/' : '/storyforge'
}

export function storyForgeDesktopProxyOrigin(
  runtimeLocation: StoryForgeRuntimeLocation | undefined = globalThis.location,
): string {
  return isStoryForgeDesktopLocation(runtimeLocation) ? 'http://127.0.0.1:17831' : ''
}
