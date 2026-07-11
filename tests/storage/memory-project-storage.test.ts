import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryProjectStorage } from '../../src/lib/storage/adapters/memory/memory-project-storage'
import { projectLocatorKey, type StorageTable } from '../../src/lib/storage/ports'
import { runStorageContract } from './storage-contract'

runStorageContract('memory', () => new MemoryProjectStorage({
  backend: 'dexie',
  projectId: 1,
}))

interface RichRecord {
  id?: number
  name: string
  payload?: unknown
}

describe('MemoryProjectStorage specifics', () => {
  let storage: MemoryProjectStorage
  let table: StorageTable<RichRecord>

  beforeEach(() => {
    storage = new MemoryProjectStorage({ backend: 'dexie', projectId: 1 })
    table = storage.table<RichRecord>('rich-records')
  })

  afterEach(async () => {
    await storage.close()
  })

  it('uses the documented readonly mutation error', async () => {
    await expect(storage.transaction('readonly', ['rich-records'], async transaction => {
      await transaction.table<RichRecord>('rich-records').delete(999)
    })).rejects.toThrow('readonly transaction modified data')
  })

  it('exposes a frozen locator snapshot whose identity survives input and reflection mutation', () => {
    const dexieLocator = { backend: 'dexie' as const, projectId: 1 }
    const dexieStorage = new MemoryProjectStorage(dexieLocator)
    const localFolderLocator = {
      backend: 'local-folder' as const,
      projectUuid: 'book-uuid',
      projectPath: 'F:/books/demo',
    }
    const localFolderStorage = new MemoryProjectStorage(localFolderLocator)

    expect(Reflect.set(dexieLocator, 'projectId', 2)).toBe(true)
    expect(Reflect.set(localFolderLocator, 'projectUuid', 'mutated-uuid')).toBe(true)
    expect(Reflect.set(localFolderStorage.locator, 'projectUuid', 'reflected-uuid')).toBe(false)

    expect(Object.isFrozen(dexieStorage.locator)).toBe(true)
    expect(Object.isFrozen(localFolderStorage.locator)).toBe(true)
    expect(projectLocatorKey(dexieStorage.locator)).toBe('dexie:1')
    expect(projectLocatorKey(localFolderStorage.locator)).toBe('local-folder:book-uuid')
  })

  it('persists Map payload changes and advances revision', async () => {
    const id = await table.add({
      name: 'Map record',
      payload: new Map([['state', 'before']]),
    })
    const revisionBefore = await storage.getRevision()

    await table.put({
      id,
      name: 'Map record',
      payload: new Map([['state', 'after']]),
    })

    const stored = await table.get(id)
    expect(stored?.payload).toBeInstanceOf(Map)
    if (!(stored?.payload instanceof Map)) {
      throw new Error('expected Map payload')
    }
    expect(stored.payload.get('state')).toBe('after')
    expect(await storage.getRevision()).not.toBe(revisionBefore)
  })
})
