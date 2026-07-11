import { describe, expect, it } from 'vitest'
import { LocalFolderProjectStorage } from '../../src/lib/storage/adapters/local-folder'
import type { ProjectFileSystemPort } from '../../src/lib/storage/ports'
import { runStorageContract } from './storage-contract'

class MemoryProjectFileSystem implements ProjectFileSystemPort {
  readonly capabilities = { atomicWrite: true, watch: false, localPaths: true }
  readonly files = new Map<string, string>()
  readonly atomicWrites: string[] = []

  async readText(path: string) {
    const value = this.files.get(path)
    if (value == null) throw new DOMException('missing', 'NotFoundError')
    return value
  }

  async writeTextAtomic(path: string, content: string) {
    this.files.set(path, content)
    this.atomicWrites.push(path)
  }

  async exists(path: string) { return this.files.has(path) }
  async remove(path: string) { this.files.delete(path) }
}

function locator() {
  return {
    backend: 'local-folder' as const,
    projectUuid: 'project-uuid',
    projectPath: 'F:/novels/demo',
  }
}

runStorageContract('local-folder', () => new LocalFolderProjectStorage(
  locator(),
  new MemoryProjectFileSystem(),
  { allowedTables: ['examples'] },
))

describe('LocalFolderProjectStorage persistence', () => {
  it('persists records and revision across storage instances', async () => {
    const fileSystem = new MemoryProjectFileSystem()
    const first = new LocalFolderProjectStorage(locator(), fileSystem, { allowedTables: ['examples'], now: () => 100 })
    await first.table('examples').add({ name: 'persistent' })
    expect(await first.getRevision()).toBe('local-folder:project-uuid:1')
    await first.close()

    const second = new LocalFolderProjectStorage(locator(), fileSystem, { allowedTables: ['examples'], now: () => 200 })
    expect(await second.table('examples').get(1)).toMatchObject({ id: 1, name: 'persistent' })
    expect(await second.getRevision()).toBe('local-folder:project-uuid:1')
    expect(fileSystem.atomicWrites).toContain('.storyforge/project-store.json')
    expect(fileSystem.atomicWrites).toContain('storyforge.project.json')
  })

  it('commits a multi-table transaction as one project-store write', async () => {
    const fileSystem = new MemoryProjectFileSystem()
    const storage = new LocalFolderProjectStorage(locator(), fileSystem, { allowedTables: ['alpha', 'beta'] })
    await storage.getRevision()
    fileSystem.atomicWrites.length = 0

    await storage.transaction('readwrite', ['alpha', 'beta'], async transaction => {
      await transaction.table('alpha').add({ value: 1 })
      await transaction.table('beta').add({ value: 2 })
    })

    expect(fileSystem.atomicWrites.filter(path => path === '.storyforge/project-store.json')).toHaveLength(1)
    expect(await storage.table('alpha').get(1)).toMatchObject({ value: 1 })
    expect(await storage.table('beta').get(1)).toMatchObject({ value: 2 })
  })

  it('does not persist a failed transaction', async () => {
    const fileSystem = new MemoryProjectFileSystem()
    const storage = new LocalFolderProjectStorage(locator(), fileSystem, { allowedTables: ['examples'] })
    await storage.getRevision()

    await expect(storage.transaction('readwrite', ['examples'], async transaction => {
      await transaction.table('examples').add({ name: 'discarded' })
      throw new Error('stop')
    })).rejects.toThrow('stop')

    expect(await storage.table('examples').list()).toEqual([])
    expect(await storage.getRevision()).toBe('local-folder:project-uuid:0')
  })

  it('round-trips Blob fields without losing bytes or media type', async () => {
    const fileSystem = new MemoryProjectFileSystem()
    const first = new LocalFolderProjectStorage(locator(), fileSystem, { allowedTables: ['files'] })
    await first.table('files').add({ content: new Blob(['novel'], { type: 'text/plain' }) })
    await first.close()

    const second = new LocalFolderProjectStorage(locator(), fileSystem, { allowedTables: ['files'] })
    const stored = await second.table<{ id?: number; content: Blob }>('files').get(1)
    expect(stored?.content).toBeInstanceOf(Blob)
    expect(stored?.content.type).toBe('text/plain')
    expect(await stored?.content.text()).toBe('novel')
  })

  it('rejects a store belonging to another project UUID', async () => {
    const fileSystem = new MemoryProjectFileSystem()
    const first = new LocalFolderProjectStorage(locator(), fileSystem, { allowedTables: ['examples'] })
    await first.getRevision()

    const wrong = new LocalFolderProjectStorage({
      backend: 'local-folder', projectUuid: 'other-project', projectPath: 'F:/novels/demo',
    }, fileSystem, { allowedTables: ['examples'] })
    await expect(wrong.getRevision()).rejects.toThrow('mismatched project store')
  })
})
