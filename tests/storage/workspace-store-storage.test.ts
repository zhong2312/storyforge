import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { activateProjectStorage, deactivateProjectStorage } from '../../src/lib/storage/application-project-storage'
import { MemoryProjectStorage } from '../../src/lib/storage/adapters/memory/memory-project-storage'
import { useWorldviewStore } from '../../src/stores/worldview'
import { useChapterStore } from '../../src/stores/chapter'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { useCharacterStore } from '../../src/stores/character'
import { assembleContext } from '../../src/lib/registry/assemble-context'

describe('Workspace stores use active project storage', () => {
  beforeEach(async () => {
    await db.open()
  })

  afterEach(async () => {
    deactivateProjectStorage()
    useWorldviewStore.setState({ worldview: null, storyCore: null, powerSystem: null, loading: false })
    useChapterStore.setState({ chapters: [], currentChapter: null, loading: false })
    useCharacterStore.setState({ characters: [], loading: false })
    await db.delete()
  })

  it('loads and saves settings through a non-Dexie backend', async () => {
    const storage = localStoragePort(21)
    activateProjectStorage(21, storage)
    await storage.table('worldviews').add({
      id: 3, projectId: 21, worldGroupId: null, worldOrigin: '文件中的旧世界', createdAt: 1, updatedAt: 1,
    })

    await useWorldviewStore.getState().loadAll(21)
    expect(useWorldviewStore.getState().worldview?.worldOrigin).toBe('文件中的旧世界')
    await useWorldviewStore.getState().saveWorldview({ projectId: 21, worldOrigin: '文件中的新世界' })

    expect(await storage.table('worldviews').get(3)).toMatchObject({ worldOrigin: '文件中的新世界' })
    expect(await db.worldviews.count()).toBe(0)
  })

  it('routes chapter CRUD through the active backend', async () => {
    const storage = localStoragePort(22)
    activateProjectStorage(22, storage)
    const id = await useChapterStore.getState().addChapter({
      projectId: 22,
      outlineNodeId: 9,
      title: '第一章',
      content: '',
      wordCount: 0,
      status: 'outline',
      order: 0,
      notes: '',
    })
    await useChapterStore.getState().updateChapter(id, { content: '<p>山门夜雨</p>', wordCount: 4 })

    expect(await storage.table('chapters').get(id)).toMatchObject({ content: '<p>山门夜雨</p>', wordCount: 4 })
    expect(await db.chapters.count()).toBe(0)
  })

  it('keeps chapter cascade deletion atomic on the active backend', async () => {
    const storage = localStoragePort(23)
    activateProjectStorage(23, storage)
    await storage.table('chapters').add({ id: 5, projectId: 23, outlineNodeId: 8, title: '旧章', order: 0 })
    await storage.table('emotionBeatCards').add({ id: 6, projectId: 23, chapterId: 5 })
    await storage.table('retrievalChunks').add({ id: 7, projectId: 23, sourceChapterId: 5 })
    await storage.table('narrativeSummaryNodes').add({ id: 8, projectId: 23, sourceChapterId: 5 })
    useChapterStore.setState({ chapters: [{ id: 5, projectId: 23 } as never] })

    await useChapterStore.getState().cascadeDeleteChapters([5])

    expect(await storage.table('chapters').list()).toEqual([])
    expect(await storage.table('emotionBeatCards').list()).toEqual([])
    expect(await storage.table('retrievalChunks').list()).toEqual([])
    expect(await storage.table('narrativeSummaryNodes').list()).toEqual([])
  })

  it('exports the active file-backed project instead of stale Dexie data', async () => {
    const storage = localStoragePort(24)
    activateProjectStorage(24, storage)
    await storage.table('projects').add({
      id: 24, name: '文件正本', genre: 'other', genres: ['other'], status: 'drafting',
      description: '', targetWordCount: 1000, createdAt: 1, updatedAt: 2,
    })
    await storage.table('chapters').add({
      id: 2, projectId: 24, outlineNodeId: 1, title: '文件章节', content: '正文', order: 0,
      wordCount: 2, status: 'draft', notes: '', createdAt: 1, updatedAt: 2,
    })

    const exported = await deriveExportProjectJSON(24)
    expect(exported.project.name).toBe('文件正本')
    expect(exported.chapters).toContainEqual(expect.objectContaining({ title: '文件章节' }))
    expect(await db.projects.count()).toBe(0)
  })

  it('assembles registered AI context from the active backend by default', async () => {
    const storage = localStoragePort(25)
    activateProjectStorage(25, storage)
    await storage.table('storyCores').add({
      id: 4, projectId: 25, mainPlot: '文件后端主线', createdAt: 1, updatedAt: 1,
    })

    const context = await assembleContext({ projectId: 25, sourceKeys: ['storyCore'] })

    expect(context.text).toContain('文件后端主线')
    expect(await db.storyCores.count()).toBe(0)
  })
})

function localStoragePort(projectId: number): MemoryProjectStorage {
  return new MemoryProjectStorage({
    backend: 'local-folder',
    projectUuid: `workspace-${projectId}`,
    projectPath: `F:/novels/workspace-${projectId}`,
  })
}
