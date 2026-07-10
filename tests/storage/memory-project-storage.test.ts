import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryProjectStorage } from '../../src/lib/storage/adapters/memory/memory-project-storage'
import type { StorageTable } from '../../src/lib/storage/ports'
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
