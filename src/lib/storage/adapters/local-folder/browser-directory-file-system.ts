import {
  normalizeProjectRelativePath,
  type ProjectFileSystemPort,
} from '../../ports'

const BROWSER_CAPABILITIES = Object.freeze({
  atomicWrite: true,
  watch: false,
  localPaths: true,
})

export class BrowserDirectoryFileSystem implements ProjectFileSystemPort {
  readonly capabilities = BROWSER_CAPABILITIES

  constructor(private readonly root: FileSystemDirectoryHandle) {}

  async readText(path: string): Promise<string> {
    const { directory, name } = await this.resolveParent(path, false)
    const handle = await directory.getFileHandle(name)
    return await (await handle.getFile()).text()
  }

  async writeTextAtomic(path: string, content: string): Promise<void> {
    const { directory, name } = await this.resolveParent(path, true)
    const handle = await directory.getFileHandle(name, { create: true })
    const writable = await handle.createWritable({ keepExistingData: false })
    try {
      await writable.write(content)
      await writable.close()
    } catch (error) {
      await writable.abort().catch(() => {})
      throw error
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      const { directory, name } = await this.resolveParent(path, false)
      await directory.getFileHandle(name)
      return true
    } catch (error) {
      if (isNotFoundError(error)) return false
      throw error
    }
  }

  async remove(path: string): Promise<void> {
    try {
      const normalized = normalizeProjectRelativePath(path)
      const segments = normalized.split('/')
      const name = segments.pop()!
      let directory = this.root
      for (const segment of segments) directory = await directory.getDirectoryHandle(segment)
      await directory.removeEntry(name)
    } catch (error) {
      if (!isNotFoundError(error)) throw error
    }
  }

  private async resolveParent(
    path: string,
    create: boolean,
  ): Promise<{ directory: FileSystemDirectoryHandle; name: string }> {
    const segments = normalizeProjectRelativePath(path).split('/')
    const name = segments.pop()!
    let directory = this.root
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment, { create })
    }
    return { directory, name }
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError'
}
