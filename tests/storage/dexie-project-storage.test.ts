import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { DexieProjectStorage } from '../../src/lib/storage/adapters/dexie'
import type { StorageRecord } from '../../src/lib/storage/ports'

interface TestRecord extends StorageRecord {
  projectId?: number
  name: string
  order?: number
}

describe('DexieProjectStorage', () => {
  let storage: DexieProjectStorage

  beforeEach(async () => {
    await db.delete()
    await db.open()
    await db.projects.bulkAdd([
      {
        id: 1,
        name: 'Project One',
        genre: 'other',
        genres: ['other'],
        status: 'drafting',
        description: '',
        targetWordCount: 100_000,
        createdAt: 100,
        updatedAt: 100,
      },
      {
        id: 2,
        name: 'Project Two',
        genre: 'other',
        genres: ['other'],
        status: 'drafting',
        description: '',
        targetWordCount: 100_000,
        createdAt: 200,
        updatedAt: 200,
      },
    ])
    storage = new DexieProjectStorage({ backend: 'dexie', projectId: 1 })
  })

  afterEach(async () => {
    await storage.close()
    await db.delete()
  })

  it('uses PROJECT_TABLES and rejects unknown and global tables', () => {
    expect(() => storage.table('missing')).toThrow('unknown project table')
    expect(() => storage.table('promptTemplates')).toThrow('unsupported table ownership')
    expect(() => storage.table('referenceChunkAnalysis')).not.toThrow()
  })

  it('scopes direct-child, indirect, transient, and Blob tables through registry ownership', async () => {
    const ownReferenceId = await db.references.add({ projectId: 1, title: 'Own' } as never)
    const foreignReferenceId = await db.references.add({ projectId: 2, title: 'Foreign' } as never)
    await db.referenceChunkAnalysis.bulkAdd([
      { referenceId: ownReferenceId, chunkIndex: 0, content: 'own' },
      { referenceId: foreignReferenceId, chunkIndex: 0, content: 'foreign' },
    ] as never)
    const ownSessionId = await db.importSessions.add({ projectId: 1, status: 'pending' } as never)
    const foreignSessionId = await db.importSessions.add({ projectId: 2, status: 'pending' } as never)
    await db.importLogs.bulkAdd([
      { sessionId: ownSessionId, message: 'own' },
      { sessionId: foreignSessionId, message: 'foreign' },
    ] as never)
    await db.importFiles.bulkPut([
      { sessionId: ownSessionId, filename: 'own.txt', blob: new Blob(['own']) },
      { sessionId: foreignSessionId, filename: 'foreign.txt', blob: new Blob(['foreign']) },
    ] as never)

    expect(await storage.table('referenceChunkAnalysis').list()).toHaveLength(1)
    expect(await storage.table('importSessions').list()).toHaveLength(1)
    expect(await storage.table('importLogs').list()).toHaveLength(1)
    const files = await storage.table<{ id?: number; filename: string }>('importFiles').list()
    expect(files).toEqual([expect.objectContaining({ id: ownSessionId, filename: 'own.txt' })])
    expect(await storage.table('importFiles').get(foreignSessionId)).toBeUndefined()
  })

  it('automatically scopes reads and query operations to the locator project', async () => {
    await db.worldviews.bulkAdd([
      { projectId: 1, summary: 'one-a', order: 2 } as never,
      { projectId: 2, summary: 'two', order: 1 } as never,
      { projectId: 1, summary: 'one-b', order: 1 } as never,
    ])
    const table = storage.table<TestRecord>('worldviews')

    const rows = await table.list({ orderBy: { field: 'order' }, offset: 1, limit: 1 })
    expect(rows).toHaveLength(1)
    expect(Reflect.get(rows[0] ?? {}, 'summary')).toBe('one-a')
    expect(await table.findOne({ where: { order: 1 } })).toMatchObject({ projectId: 1, order: 1 })
  })

  it('stamps projectId and rejects cross-project writes', async () => {
    const table = storage.table<TestRecord>('characters')
    const id = await table.add({ name: 'Alice' })
    expect(await db.characters.get(id)).toMatchObject({ id, projectId: 1, name: 'Alice' })

    await expect(table.add({ projectId: 2, name: 'Mallory' }))
      .rejects.toThrow('cross-project write rejected')
    expect(await db.characters.where('projectId').equals(2).count()).toBe(0)
  })

  it('does not expose or mutate another project record by primary key', async () => {
    const foreignId = await db.characters.add({ projectId: 2, name: 'Foreign' } as never)
    const table = storage.table<TestRecord>('characters')

    expect(await table.get(foreignId)).toBeUndefined()
    await expect(table.update(foreignId, { name: 'Changed' })).rejects.toThrow('record not found in project')
    await expect(table.delete(foreignId)).rejects.toThrow('record not found in project')
    expect(await db.characters.get(foreignId)).toMatchObject({ projectId: 2, name: 'Foreign' })
  })

  it('matches the storage contract for explicit-id upserts and missing deletes', async () => {
    const table = storage.table<TestRecord>('characters')

    expect(await table.put({ id: 999, name: 'Explicit' })).toBe(999)
    expect(await table.get(999)).toMatchObject({ id: 999, projectId: 1, name: 'Explicit' })
    const revision = await storage.getRevision()
    await expect(table.delete(404)).resolves.toBeUndefined()
    await expect(table.bulkDelete([404, 405])).resolves.toBeUndefined()
    expect(await storage.getRevision()).toBe(revision)
  })

  it('commits declared readwrite tables atomically and advances revision once durable', async () => {
    const revisionBefore = await storage.getRevision()
    await storage.transaction('readwrite', ['characters', 'chapters'], async transaction => {
      await transaction.table<TestRecord>('characters').add({ name: 'Alice' })
      await transaction.table<TestRecord>('chapters').add({ name: 'Chapter 1' })
    })

    expect(await db.characters.where('projectId').equals(1).count()).toBe(1)
    expect(await db.chapters.where('projectId').equals(1).count()).toBe(1)
    expect(await storage.getRevision()).not.toBe(revisionBefore)
  })

  it('rolls back all writes when transaction work fails', async () => {
    await expect(storage.transaction('readwrite', ['characters', 'chapters'], async transaction => {
      await transaction.table<TestRecord>('characters').add({ name: 'Alice' })
      await transaction.table<TestRecord>('chapters').add({ name: 'Chapter 1' })
      throw new Error('rollback')
    })).rejects.toThrow('rollback')

    expect(await db.characters.where('projectId').equals(1).count()).toBe(0)
    expect(await db.chapters.where('projectId').equals(1).count()).toBe(0)
  })

  it('rejects writes in readonly transactions and undeclared table access', async () => {
    await expect(storage.transaction('readonly', ['characters'], async transaction => {
      await transaction.table<TestRecord>('characters').add({ name: 'Alice' })
    })).rejects.toThrow('readonly transaction modified data')

    await expect(storage.transaction('readonly', ['characters'], async transaction => {
      transaction.table<TestRecord>('chapters')
    })).rejects.toThrow('table is not part of transaction')
  })

  it('invalidates transaction facades after completion', async () => {
    let captured: ReturnType<DexieProjectStorage['table']> | undefined
    await storage.transaction('readonly', ['characters'], async transaction => {
      captured = transaction.table('characters')
    })

    await expect(captured?.list()).rejects.toThrow('transaction is no longer active')
  })
})
