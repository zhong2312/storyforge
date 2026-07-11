import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { activateProjectStorage, deactivateProjectStorage } from '../../src/lib/storage/application-project-storage'
import { projectDb } from '../../src/lib/storage/project-db-compat'
import { MemoryProjectStorage } from '../../src/lib/storage/adapters/memory/memory-project-storage'

describe('projectDb compatibility gateway', () => {
  afterEach(async () => {
    deactivateProjectStorage()
    await db.delete()
  })

  it('routes Dexie-style queries and writes to the active storage port', async () => {
    const storage = new MemoryProjectStorage({ backend: 'dexie', projectId: 7 })
    activateProjectStorage(7, storage)
    await storage.table('projects').add({ id: 7, name: 'port project' })
    await storage.table('chapters').add({ id: 11, projectId: 7, title: '第二章', order: 2 })
    await storage.table('chapters').add({ id: 10, projectId: 7, title: '第一章', order: 1 })

    const rows = await projectDb.chapters.where('projectId').equals(7).sortBy('order')
    expect(rows.map(row => row.title)).toEqual(['第一章', '第二章'])
    expect(await projectDb.chapters.get(10)).toMatchObject({ title: '第一章' })

    await projectDb.chapters.update(10, { title: '第一章 新题' })
    expect(await storage.table('chapters').get(10)).toMatchObject({ title: '第一章 新题' })
    expect(await db.chapters.count()).toBe(0)
  })

  it('runs multi-table writes through one storage transaction', async () => {
    const storage = new MemoryProjectStorage({ backend: 'dexie', projectId: 8 })
    activateProjectStorage(8, storage)

    await projectDb.transaction('rw', projectDb.characters, projectDb.notes, async () => {
      await projectDb.characters.add({ projectId: 8, name: '林川' } as never)
      await projectDb.notes.add({ projectId: 8, title: '人物备注', content: '' } as never)
    })

    expect(await storage.table('characters').list()).toHaveLength(1)
    expect(await storage.table('notes').list()).toHaveLength(1)
  })
})
