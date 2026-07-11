export interface ProjectFileSystemCapabilities {
  readonly atomicWrite: boolean
  readonly watch: boolean
  readonly localPaths: boolean
}

export interface ProjectFileSystemPort {
  readonly capabilities: ProjectFileSystemCapabilities
  readText(path: string): Promise<string>
  writeTextAtomic(path: string, content: string): Promise<void>
  exists(path: string): Promise<boolean>
  remove(path: string): Promise<void>
  watch?(listener: () => void): () => void
}

export function normalizeProjectRelativePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  const segments = normalized.split('/').filter(Boolean)
  if (!segments.length || segments.some(segment => segment === '.' || segment === '..')) {
    throw new Error(`[project-fs] invalid project-relative path: ${path}`)
  }
  return segments.join('/')
}
