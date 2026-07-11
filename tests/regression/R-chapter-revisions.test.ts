import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StoryForgeDB, db } from '../../src/lib/db/schema'
import { adopt } from '../../src/lib/registry/adopt'
import { useChapterStore } from '../../src/stores/chapter'
import { MemoryProjectStorage } from '../../src/lib/storage/adapters/memory/memory-project-storage'

const now = 1_700_000_000_000

async function seedChapter(content = '<p>初稿</p>') {
  const projectId = await db.projects.add({
    name: '历史测试', genre: '', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId, parentId: null, type: 'chapter', title: '第一章', summary: '', order: 0,
    createdAt: now, updatedAt: now,
  } as any) as number
  const chapterId = await db.chapters.add({
    projectId, outlineNodeId, title: '第一章', content, wordCount: 2,
    status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  await useChapterStore.getState().loadAll(projectId)
  useChapterStore.getState().selectChapter(chapterId)
  return { projectId, chapterId }
}

describe('章节正文历史与恢复', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useChapterStore.setState({ chapters: [], currentChapter: null, loading: false })
  })

  afterEach(() => db.close())

  it('保存旧正文并归并同一轮连续自动编辑', async () => {
    const { chapterId } = await seedChapter()
    const store = useChapterStore.getState()

    await store.updateChapter(chapterId, { content: '<p>第二稿</p>', wordCount: 3 })
    await store.updateChapter(chapterId, { content: '<p>第三稿</p>', wordCount: 3 })

    expect((await db.chapters.get(chapterId))?.content).toBe('<p>第三稿</p>')
    const revisions = await db.chapterRevisions.where('chapterId').equals(chapterId).toArray()
    expect(revisions).toHaveLength(1)
    expect(revisions[0].content).toBe('<p>初稿</p>')
    expect(revisions[0].source).toBe('edit')
  })

  it('Agent 采纳正文时在同一写回链路保存采纳前版本', async () => {
    const { projectId, chapterId } = await seedChapter()

    const result = await adopt({
      projectId,
      target: 'chapters',
      recordId: chapterId,
      mode: 'replace',
      data: { content: '<p>AI 正式正文</p>', wordCount: 6 },
    })

    expect(result.skipped).toEqual([])
    expect((await db.chapters.get(chapterId))?.content).toBe('<p>AI 正式正文</p>')
    const revision = await db.chapterRevisions.where('chapterId').equals(chapterId).first()
    expect(revision?.content).toBe('<p>初稿</p>')
    expect(revision?.source).toBe('agent')
  })

  it('Agent 使用统一存储端口时仍原子写入正文与历史', async () => {
    const storage = new MemoryProjectStorage({ backend: 'dexie', projectId: 7 })
    const chapterId = await storage.table('chapters').add({
      projectId: 7,
      outlineNodeId: 1,
      title: '第一章',
      content: '<p>端口旧稿</p>',
      wordCount: 4,
      status: 'draft',
      order: 0,
      notes: '',
      createdAt: now,
      updatedAt: now,
    })

    const result = await adopt({
      projectId: 7,
      target: 'chapters',
      recordId: chapterId,
      mode: 'replace',
      data: { content: '<p>端口新稿</p>', wordCount: 4 },
    }, { storage })

    expect(result.skipped).toEqual([])
    expect((await storage.table<any>('chapters').get(chapterId))?.content).toBe('<p>端口新稿</p>')
    const revisions = await storage.table<any>('chapterRevisions').list({ where: { chapterId } })
    expect(revisions).toMatchObject([{ content: '<p>端口旧稿</p>', source: 'agent' }])
  })

  it('恢复前保存当前正文，因此历史恢复可反向恢复', async () => {
    const { chapterId } = await seedChapter()
    await useChapterStore.getState().updateChapter(
      chapterId,
      { content: '<p>第二稿</p>', wordCount: 3 },
      { revisionSource: 'manual', coalesceEdits: false },
    )
    const firstRevision = await db.chapterRevisions.where('chapterId').equals(chapterId).first()
    expect(firstRevision?.id).toBeTypeOf('number')

    expect(await useChapterStore.getState().restoreChapterRevision(firstRevision!.id!)).toBe(true)
    expect((await db.chapters.get(chapterId))?.content).toBe('<p>初稿</p>')

    const revisions = await db.chapterRevisions.where('chapterId').equals(chapterId).toArray()
    const secondDraft = revisions.find(revision => revision.content === '<p>第二稿</p>')
    expect(secondDraft?.source).toBe('restore')
    expect(await useChapterStore.getState().restoreChapterRevision(secondDraft!.id!)).toBe(true)
    expect((await db.chapters.get(chapterId))?.content).toBe('<p>第二稿</p>')
  })

  it('每章最多保留 100 条历史记录', async () => {
    const { chapterId } = await seedChapter()
    for (let index = 1; index <= 105; index += 1) {
      await useChapterStore.getState().updateChapter(
        chapterId,
        { content: `<p>版本 ${index}</p>`, wordCount: 3 },
        { revisionSource: 'manual', coalesceEdits: false },
      )
    }

    const revisions = await db.chapterRevisions.where('chapterId').equals(chapterId).toArray()
    expect(revisions).toHaveLength(100)
    expect(revisions.some(revision => revision.content === '<p>初稿</p>')).toBe(false)
    expect(revisions.some(revision => revision.content === '<p>版本 5</p>')).toBe(true)
  })

  it('删除章节时级联删除正文历史', async () => {
    const { chapterId } = await seedChapter()
    await useChapterStore.getState().updateChapter(chapterId, { content: '<p>第二稿</p>' })
    await useChapterStore.getState().deleteChapter(chapterId)

    expect(await db.chapters.get(chapterId)).toBeUndefined()
    expect(await db.chapterRevisions.where('chapterId').equals(chapterId).count()).toBe(0)
  })
})

describe('v37 → v38 章节历史表升级', () => {
  const names: string[] = []
  const opened: Dexie[] = []

  afterEach(async () => {
    for (const database of opened.splice(0)) database.close()
    for (const name of names.splice(0)) await Dexie.delete(name)
  })

  it('保留旧章节正文并创建可写的 chapterRevisions 表', async () => {
    const name = `chapter-revision-upgrade-${Math.random()}`
    names.push(name)
    const legacy = new Dexie(name)
    opened.push(legacy)
    legacy.version(37).stores({
      chapters: '++id, projectId, outlineNodeId, order, status',
    })
    await legacy.open()
    const chapterId = await legacy.table('chapters').add({
      projectId: 1, outlineNodeId: 1, order: 0, status: 'draft',
      title: '第一章', content: '<p>旧用户正文</p>', wordCount: 6,
      notes: '', createdAt: now, updatedAt: now,
    }) as number
    legacy.close()

    const upgraded = new StoryForgeDB(name)
    opened.push(upgraded)
    await upgraded.open()
    expect((await upgraded.chapters.get(chapterId))?.content).toBe('<p>旧用户正文</p>')
    expect(upgraded.tables.map(table => table.name)).toContain('chapterRevisions')
    await expect(upgraded.chapterRevisions.add({
      projectId: 1, chapterId, content: '<p>旧用户正文</p>', wordCount: 6,
      source: 'manual', createdAt: now,
    })).resolves.toBeTypeOf('number')
  })
})
