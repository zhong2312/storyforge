/**
 * R-NS5-retrieval · 叙事感知检索（NS-5）
 * 守卫：切块+关键词、按 hash 复用/重建、关键词召回、未来章不泄漏、世界隔离、按时间重组。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  splitIntoChunks,
  extractKeywords,
  rebuildChapterChunks,
  rebuildProjectRetrievalChunks,
  buildProjectRagDocuments,
  projectRagSourceTables,
  searchProjectRag,
  rebuildProjectNarrativeSummaries,
  readNarrativeSummaryContext,
  retrieveChunks,
} from '../../src/lib/retrieval/retrieval'
import { useChapterStore } from '../../src/stores/chapter'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'

const now = Date.now()
async function seedChapters(texts: string[]) {
  const pid = await db.projects.add({ name: 'P', genre: 'x', description: '', targetWordCount: 0, enableMultiWorld: false, createdAt: now, updatedAt: now } as any) as number
  const vol = await db.outlineNodes.add({ projectId: pid, parentId: null, type: 'volume', title: '卷', summary: '', order: 0, createdAt: now, updatedAt: now } as any) as number
  const chaps: number[] = []
  for (let i = 0; i < texts.length; i++) {
    const n = await db.outlineNodes.add({ projectId: pid, parentId: vol, type: 'chapter', title: `第${i + 1}章`, summary: '', order: i, createdAt: now, updatedAt: now } as any) as number
    const c = await db.chapters.add({ projectId: pid, outlineNodeId: n, title: `第${i + 1}章`, content: texts[i], wordCount: 0, status: 'draft', order: i, notes: '', createdAt: now, updatedAt: now } as any) as number
    chaps.push(c)
  }
  return { pid, chaps }
}

describe('NS-5 · retrieval', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('切块与关键词抽取', () => {
    expect(splitIntoChunks('').length).toBe(0)
    expect(splitIntoChunks('一段\n二段\n三段').length).toBeGreaterThan(0)
    expect(extractKeywords('林飞拿起青铜铃', ['林飞', '苏禾', '青铜铃'])).toEqual(expect.arrayContaining(['林飞', '青铜铃']))
  })

  it('正文未变复用、变了重建', async () => {
    const { pid, chaps } = await seedChapters(['林飞在洛阳。'])
    const ch = await db.chapters.get(chaps[0])
    const r1 = await rebuildChapterChunks({ projectId: pid, chapter: ch!, knownEntities: ['林飞'] })
    expect(r1.rebuilt).toBe(true)
    const r2 = await rebuildChapterChunks({ projectId: pid, chapter: ch!, knownEntities: ['林飞'] })
    expect(r2.rebuilt).toBe(false) // hash 相同复用
    await db.chapters.update(chaps[0], { content: '林飞到了北境。' })
    const ch2 = await db.chapters.get(chaps[0])
    const r3 = await rebuildChapterChunks({ projectId: pid, chapter: ch2!, knownEntities: ['林飞'] })
    expect(r3.rebuilt).toBe(true) // 正文变→重建
  })

  it('关键词召回 + 未来章不泄漏', async () => {
    const { pid, chaps } = await seedChapters([
      '第一章：林飞在洛阳被预言只剩十六年阳寿。',
      '第二章：林飞前往北境。',
      '第三章：林飞抵达轮回沙海。', // 当前章(未来)
    ])
    for (const c of chaps) {
      const ch = await db.chapters.get(c)
      await rebuildChapterChunks({ projectId: pid, chapter: ch!, knownEntities: ['林飞'] })
    }
    // 在写第3章时召回（currentChapter = chaps[2]）
    const got = await retrieveChunks({ projectId: pid, currentChapterId: chaps[2], queryTerms: ['林飞'], topK: 5 })
    const sources = got.map(r => r.chunk.sourceChapterId)
    expect(sources).toContain(chaps[0])
    expect(sources).toContain(chaps[1])
    expect(sources).not.toContain(chaps[2]) // 当前/未来章不召回
  })

  it('老项目一键重建：没有 retrievalChunks 时先为历史章节切块，再可召回', async () => {
    const { pid, chaps } = await seedChapters([
      '第一章：林飞把青铜铃交给苏禾保管。',
      '第二章：当前要写苏禾归还铃铛。',
    ])
    await db.characters.add({ projectId: pid, name: '苏禾', role: 'supporting', createdAt: now, updatedAt: now } as any)
    const categoryId = await db.codexCategories.add({ projectId: pid, name: '器物', order: 0, createdAt: now, updatedAt: now } as any) as number
    await db.codexEntries.add({ projectId: pid, categoryId, name: '青铜铃', order: 0, createdAt: now, updatedAt: now } as any)

    expect(await db.retrievalChunks.where('projectId').equals(pid).count()).toBe(0)
    const built = await rebuildProjectRetrievalChunks({ projectId: pid })
    expect(built.chapters).toBe(2)
    expect(built.chunks).toBeGreaterThan(0)
    const got = await retrieveChunks({ projectId: pid, currentChapterId: chaps[1], queryTerms: ['苏禾', '青铜铃'] })
    expect(got.map(r => r.chunk.sourceChapterId)).toContain(chaps[0])
    expect(got.map(r => r.chunk.text).join('\n')).toContain('青铜铃')
  })

  it('层级摘要树：重建章→卷→全书，并按当前章只注入 verified 前文', async () => {
    const { pid, chaps } = await seedChapters([
      '第一章：林飞把青铜铃交给苏禾保管。',
      '第二章：苏禾带着青铜铃进入北境。',
      '第三章：当前章。',
    ])

    const built = await rebuildProjectNarrativeSummaries({ projectId: pid })
    expect(built.chapterNodes).toBe(3)
    expect(built.volumeNodes).toBe(1)
    expect(built.bookNodes).toBe(1)

    const nodes = await db.narrativeSummaryNodes.where('projectId').equals(pid).toArray()
    expect(nodes.some(node => node.level === 'book' && node.summary.includes('青铜铃'))).toBe(true)

    const ctx = await readNarrativeSummaryContext({ projectId: pid, currentChapterId: chaps[2] })
    expect(ctx).toContain('全书')
    expect(ctx).toContain('本卷')
    expect(ctx).toContain('青铜铃')
    expect(ctx).not.toContain('第三章：当前章') // 当前/未来章正文不注入
  })

  it('层级摘要 stale 防线：正文修改后旧摘要节点不再注入', async () => {
    const { pid, chaps } = await seedChapters([
      '第一章：林飞把青铜铃交给苏禾保管。',
      '第二章：当前章。',
    ])
    await useChapterStore.getState().loadAll(pid)
    await rebuildProjectNarrativeSummaries({ projectId: pid })

    await useChapterStore.getState().updateChapter(chaps[0], {
      content: '第一章：旧物已删除。',
      wordCount: 8,
    })

    const stale = await db.narrativeSummaryNodes.where('projectId').equals(pid).filter(node => node.status === 'stale').toArray()
    expect(stale.length).toBeGreaterThan(0)
    const ctx = await readNarrativeSummaryContext({ projectId: pid, currentChapterId: chaps[1] })
    expect(ctx).not.toContain('青铜铃')
  })

  it('世界隔离：别的世界的块不召回', async () => {
    const { pid, chaps } = await seedChapters(['第一章：林飞在洛阳。', '第二章：当前。'])
    const ch0 = await db.chapters.get(chaps[0])
    await rebuildChapterChunks({ projectId: pid, chapter: ch0!, worldGroupId: 99, knownEntities: ['林飞'] })
    const got = await retrieveChunks({ projectId: pid, currentChapterId: chaps[1], worldGroupId: 7, queryTerms: ['林飞'] })
    expect(got.length).toBe(0) // 块在世界99，当前世界7 → 不召回
  })

  it('全项目 RAG 来源严格派生自 PROJECT_TABLES 的可导出项目数据', async () => {
    const { pid } = await seedChapters(['第一章：雨夜入城。'])
    await db.characters.add({
      projectId: pid, name: '顾潮生', role: 'supporting', ending: '守住无潮港', createdAt: now, updatedAt: now,
    } as any)
    await db.notes.add({ projectId: pid, title: '港口规则', content: '午夜后禁止鸣钟', createdAt: now, updatedAt: now } as any)

    expect(projectRagSourceTables()).toEqual(
      PROJECT_TABLES.filter(spec => spec.exportable && spec.owner !== 'global').map(spec => spec.name),
    )
    const documents = await buildProjectRagDocuments({ projectId: pid })
    const populatedSources = documents.map(document => document.sourceTable)
    expect(populatedSources).toEqual(expect.arrayContaining(['projects', 'chapters', 'characters', 'notes']))
    expect(documents.find(document => document.sourceTable === 'characters')?.text).toContain('守住无潮港')
    expect(documents.find(document => document.sourceTable === 'notes')?.text).toContain('午夜后禁止鸣钟')
  })

  it('全项目 RAG 可检索设定，同时在章节范围内禁止泄漏当前和未来正文', async () => {
    const { pid, chaps } = await seedChapters([
      '第一章：林飞将赤铜钥匙埋在古槐树下。',
      '第二章：苏禾准备寻找钥匙。',
      '第三章：未来才揭示钥匙能开启天门。',
    ])
    await db.characters.add({
      projectId: pid, name: '苏禾', role: 'supporting', ending: '最终成为天门守钥人', createdAt: now, updatedAt: now,
    } as any)

    const settingHits = await searchProjectRag({ projectId: pid, query: '谁是天门守钥人', sourceTables: ['characters'] })
    expect(settingHits[0]).toMatchObject({ sourceTable: 'characters', sourceTitle: '苏禾' })

    const chapterHits = await searchProjectRag({
      projectId: pid,
      currentChapterId: chaps[1],
      query: '赤铜钥匙天门',
      sourceTables: ['chapters'],
    })
    expect(chapterHits.map(hit => hit.sourceChapterId)).toContain(chaps[0])
    expect(chapterHits.map(hit => hit.sourceChapterId)).not.toContain(chaps[1])
    expect(chapterHits.map(hit => hit.sourceChapterId)).not.toContain(chaps[2])
  })

  it('全项目 RAG 按规范章节过滤未来章纲和细纲，并隔离章节所属世界', async () => {
    const { pid, chaps } = await seedChapters([
      '第一章正文。',
      '第二章正文。',
      '第三章正文。',
    ])
    const chapters = await db.chapters.where('projectId').equals(pid).toArray()
    const first = chapters.find(chapter => chapter.id === chaps[0])!
    const future = chapters.find(chapter => chapter.id === chaps[2])!
    await db.outlineNodes.update(first.outlineNodeId, { summary: '旧港密令藏在第一章。', worldGroupId: 99 })
    await db.outlineNodes.update(future.outlineNodeId, { summary: '未来才揭示星门坐标。', worldGroupId: 7 })
    await db.detailedOutlines.add({
      projectId: pid,
      outlineNodeId: future.outlineNodeId,
      summary: '细纲写明星门坐标位于王陵。',
      scenes: [],
      appearingCharacterIds: [],
      createdAt: now,
      updatedAt: now,
    } as any)

    const futureHits = await searchProjectRag({
      projectId: pid,
      currentChapterId: chaps[1],
      worldGroupId: 7,
      query: '星门坐标王陵',
      sourceTables: ['outlineNodes', 'detailedOutlines'],
    })
    expect(futureHits).toEqual([])

    const otherWorldHits = await searchProjectRag({
      projectId: pid,
      currentChapterId: chaps[1],
      worldGroupId: 7,
      query: '旧港密令',
      sourceTables: ['outlineNodes'],
    })
    expect(otherWorldHits).toEqual([])
  })

  it('正文变化和历史恢复会清除旧正文块，但保留同章其他来源块', async () => {
    const { pid, chaps } = await seedChapters(['旧稿写着赤铜钥匙。'])
    await useChapterStore.getState().loadAll(pid)
    const chapter = await db.chapters.get(chaps[0])
    await rebuildChapterChunks({ projectId: pid, chapter: chapter!, knownEntities: [] })
    const linkedId = await db.retrievalChunks.add({
      projectId: pid,
      worldGroupId: null,
      sourceChapterId: chaps[0],
      sourceTable: 'storyTimelineEvents',
      sourceRecordId: 1,
      sourceTitle: '时间线',
      chunkIndex: 0,
      text: '时间线仍应保留',
      keywords: ['时间线'],
      embedding: null,
      embeddingModel: null,
      sourceTextHash: 'timeline',
      createdAt: now,
    }) as number

    await useChapterStore.getState().updateChapter(chaps[0], { content: '新稿不再包含钥匙。', wordCount: 9 })
    expect((await db.retrievalChunks.where('sourceChapterId').equals(chaps[0]).toArray())
      .filter(chunk => (chunk.sourceTable ?? 'chapters') === 'chapters')).toEqual([])
    expect(await db.retrievalChunks.get(linkedId)).toBeDefined()

    const revision = await db.chapterRevisions.where('chapterId').equals(chaps[0]).first()
    await rebuildChapterChunks({
      projectId: pid,
      chapter: (await db.chapters.get(chaps[0]))!,
      knownEntities: [],
    })
    expect(await useChapterStore.getState().restoreChapterRevision(revision!.id!)).toBe(true)
    expect((await db.retrievalChunks.where('sourceChapterId').equals(chaps[0]).toArray())
      .filter(chunk => (chunk.sourceTable ?? 'chapters') === 'chapters')).toEqual([])
    expect(await db.retrievalChunks.get(linkedId)).toBeDefined()
  })

  it('建立索引会写入非章节来源元数据，并在源记录变化后替换旧块', async () => {
    const { pid } = await seedChapters(['第一章：雨夜入城。'])
    const characterId = await db.characters.add({
      projectId: pid, name: '闻铃', role: 'supporting', ending: '留守北境', createdAt: now, updatedAt: now,
    } as any) as number
    const first = await rebuildProjectRetrievalChunks({ projectId: pid })
    expect(first.tables).toBe(projectRagSourceTables().length)
    expect(first.records).toBeGreaterThanOrEqual(2)
    const oldChunk = (await db.retrievalChunks.where('projectId').equals(pid).toArray())
      .find(chunk => chunk.sourceTable === 'characters' && chunk.sourceRecordId === characterId)
    expect(oldChunk?.text).toContain('留守北境')

    await db.characters.update(characterId, { ending: '远赴东海' })
    await rebuildProjectRetrievalChunks({ projectId: pid })
    const nextChunks = (await db.retrievalChunks.where('projectId').equals(pid).toArray())
      .filter(chunk => chunk.sourceTable === 'characters' && chunk.sourceRecordId === characterId)
    expect(nextChunks).toHaveLength(1)
    expect(nextChunks[0].text).toContain('远赴东海')
    expect(nextChunks[0].text).not.toContain('留守北境')
  })

  it('全项目 RAG 使用已建立的非章节 embedding 进行语义召回', async () => {
    const { pid } = await seedChapters(['第一章正文。'])
    const noteId = await db.notes.add({
      projectId: pid,
      title: '北境旧约',
      content: '霜降之后城门永不关闭',
      createdAt: now,
      updatedAt: now,
    } as any) as number
    await rebuildProjectRetrievalChunks({ projectId: pid })
    const chunk = (await db.retrievalChunks.where('projectId').equals(pid).toArray())
      .find(item => item.sourceTable === 'notes' && item.sourceRecordId === noteId)!
    await db.retrievalChunks.update(chunk.id!, { embedding: [1, 0], embeddingModel: 'semantic-test' })

    const hits = await searchProjectRag({
      projectId: pid,
      query: '没有任何共同关键词',
      sourceTables: ['notes'],
      queryEmbedding: [1, 0],
      queryEmbeddingModel: 'semantic-test',
    })
    expect(hits[0]).toMatchObject({ sourceTable: 'notes', sourceRecordId: noteId })
  })

  it('默认 RAG 排除未审批推演，显式指定来源时仍可检索', async () => {
    const { pid, chaps } = await seedChapters(['第一章正文。'])
    const sessionId = await db.plotSimulationSessions.add({
      projectId: pid,
      sessionKey: 'tentative',
      title: '候选推演',
      premise: '测试',
      goal: '测试',
      status: 'completed',
      chapterId: chaps[0],
      selectedCharacterIds: [],
      plannedTurns: 1,
      currentTurn: 1,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    await db.plotSimulationTurns.add({
      projectId: pid,
      sessionId,
      turnNumber: 1,
      worldState: { pressure: '', events: [], constraints: [] },
      characterActions: [],
      narration: '候选中角色死于潮汐井',
      summary: '角色死亡',
      worldChanges: [],
      unresolvedHooks: [],
      createdAt: now,
      updatedAt: now,
    } as any)

    expect(await searchProjectRag({ projectId: pid, query: '潮汐井死亡' })).toEqual([])
    expect(await searchProjectRag({
      projectId: pid,
      query: '潮汐井死亡',
      sourceTables: ['plotSimulationTurns'],
    })).toMatchObject([{ sourceTable: 'plotSimulationTurns' }])
  })

  it('局部重建章节时不误删同章关联的其他数据块', async () => {
    const { pid, chaps } = await seedChapters(['第一章：雨夜入城。'])
    await db.storyTimelineEvents.add({
      projectId: pid,
      chapterId: chaps[0],
      title: '城门关闭',
      description: '子时封城',
      importance: 'major',
      createdAt: now,
    } as any)
    await rebuildProjectRetrievalChunks({ projectId: pid })
    const before = (await db.retrievalChunks.where('sourceChapterId').equals(chaps[0]).toArray())
      .find(chunk => chunk.sourceTable === 'storyTimelineEvents')
    expect(before?.text).toContain('子时封城')

    const chapter = await db.chapters.get(chaps[0])
    await rebuildChapterChunks({ projectId: pid, chapter: { ...chapter!, content: '第一章：破晓出城。' }, knownEntities: [] })
    expect(await db.retrievalChunks.get(before!.id!)).toMatchObject({
      sourceTable: 'storyTimelineEvents',
      text: expect.stringContaining('子时封城'),
    })
  })
})
