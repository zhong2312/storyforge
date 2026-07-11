import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { projectScopedTables } from '../../src/lib/registry/lifecycle'
import { DexieProjectStorage } from '../../src/lib/storage/adapters/dexie'
import { LocalFolderProjectStorage } from '../../src/lib/storage/adapters/local-folder'
import { MemoryProjectStorage } from '../../src/lib/storage/adapters/memory/memory-project-storage'
import { migrateProjectStorage } from '../../src/lib/storage/storage-migration'
import type { ProjectFileSystemPort } from '../../src/lib/storage/ports'

class MemoryFileSystem implements ProjectFileSystemPort {
  readonly capabilities = { atomicWrite: true, watch: false, localPaths: true }
  readonly files = new Map<string, string>()
  async readText(path: string) { return this.files.get(path) ?? '' }
  async writeTextAtomic(path: string, content: string) { this.files.set(path, content) }
  async exists(path: string) { return this.files.has(path) }
  async remove(path: string) { this.files.delete(path) }
}

function createSource() {
  return new MemoryProjectStorage({ backend: 'dexie', projectId: 1 })
}

function createTarget(fileSystem = new MemoryFileSystem()) {
  return new LocalFolderProjectStorage({
    backend: 'local-folder', projectUuid: 'uuid-1', projectPath: 'F:/novels/demo',
  }, fileSystem, { allowedTables: ['projects', 'chapters', 'importFiles'] })
}

describe('storage migration', () => {
  it('copies all requested tables and verifies structured and Blob content', async () => {
    const source = new LocalFolderProjectStorage({
      backend: 'local-folder', projectUuid: 'source-uuid', projectPath: 'F:/novels/source',
    }, new MemoryFileSystem(), { allowedTables: ['projects', 'chapters', 'importFiles'] })
    await source.table('projects').put({ id: 1, name: 'Novel' })
    await source.table('chapters').bulkPut([
      { id: 2, projectId: 1, title: 'Second', content: 'B' },
      { id: 1, projectId: 1, title: 'First', content: 'A' },
    ])
    await source.table('importFiles').put({ id: 9, blob: new Blob(['source'], { type: 'text/plain' }) })
    const target = createTarget()

    const report = await migrateProjectStorage(source, target, {
      tableNames: ['projects', 'chapters', 'importFiles'],
    })

    expect(report.valid).toBe(true)
    expect(report.tables).toHaveLength(3)
    expect(await target.table('chapters').list()).toEqual(await source.table('chapters').list())
    const targetBlob = Reflect.get(await target.table('importFiles').get(9) ?? {}, 'blob') as Blob
    expect(await targetBlob.text()).toBe('source')
    expect(await source.table('chapters').list()).toHaveLength(2)
  })

  it('rejects a non-empty target without changing source data', async () => {
    const source = createSource()
    await source.table('chapters').add({ title: 'Source' })
    const target = createTarget()
    await target.table('chapters').add({ title: 'Target' })

    await expect(migrateProjectStorage(source, target, { tableNames: ['chapters'] }))
      .rejects.toThrow('target table is not empty')
    expect(await source.table('chapters').list()).toHaveLength(1)
  })
})

describe('Dexie to local-folder full registry migration', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    await db.delete()
  })

  it('covers every non-global PROJECT_TABLES entry including indirect and Blob records', async () => {
    await db.projects.add({ id: 1, name: 'Full Novel', createdAt: 1, updatedAt: 1 } as never)
    await db.chapters.add({ projectId: 1, title: 'Chapter', content: 'Body' } as never)
    const referenceId = await db.references.add({ projectId: 1, title: 'Reference' } as never)
    await db.referenceChunkAnalysis.add({ referenceId, chunkIndex: 0, content: 'Analysis' } as never)
    const sessionId = await db.importSessions.add({ projectId: 1, status: 'pending' } as never)
    await db.importLogs.add({ sessionId, message: 'Log' } as never)
    await db.importFiles.put({
      sessionId, filename: 'source.txt', fileHash: 'hash', fileSize: 6,
      blob: new Blob(['source'], { type: 'text/plain' }), createdAt: 1,
    })

    const source = new DexieProjectStorage({ backend: 'dexie', projectId: 1 })
    const target = new LocalFolderProjectStorage({
      backend: 'local-folder', projectUuid: 'full-uuid', projectPath: 'F:/novels/full',
    }, new MemoryFileSystem())
    const report = await migrateProjectStorage(source, target)

    expect(report.valid).toBe(true)
    expect(report.tables.map(table => table.table).sort())
      .toEqual(projectScopedTables().map(spec => spec.name).sort())
    expect(await target.table('referenceChunkAnalysis').list()).toHaveLength(1)
    const file = await target.table('importFiles').get(sessionId)
    expect(file).toMatchObject({ id: sessionId, filename: 'source.txt' })
    expect(await db.projects.get(1)).toMatchObject({ name: 'Full Novel' })
  })
})
