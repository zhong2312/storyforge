import { db } from '../db/schema'
import type {
  Project, Worldview, StoryCore, PowerSystem,
  Character, Faction, OutlineNode, Chapter,
  Foreshadow, Geography, History, ItemSystem,
  CreativeRules, CharacterRelation,
  DetailedOutline, EmotionBeatCard, StateCard,
  StoryArc, WorldNode, Note,
  Reference, ReferenceChunkAnalysis,
  HistoricalTimelineEvent, HistoricalKeyword,
  MasterWork, MasterChunkAnalysis, MasterChapterBeat,
  MasterStyleMetrics, MasterInsight,
  WorldGroup, WorldGroupLink, ItemLedgerEntry, StoryTimelineEvent,
  ImportantLocation, WorldRulesProfile, CodexCategory, CodexEntry,
} from '../types'

/**
 * 完整项目导出数据结构
 *
 * version 历史：
 *   1 — 初始版本（14 张表）
 *   2 — 补全全部项目数据（2026-05-27）：
 *       新增 detailedOutlines, emotionBeatCards, stateCards, storyArcs,
 *       worldNodes, notes, references, referenceChunkAnalysis,
 *       historicalTimelineEvents, historicalKeywords,
 *       masterWorks, masterChunkAnalysis, masterChapterBeats,
 *       masterStyleMetrics, masterInsights
 *   3 — 多世界系统（2026-06-02，Phase 25.4）：
 *       新增 worldGroups, worldGroupLinks；
 *       现有表记录携带 worldGroupId / homeWorldGroupId / isCrossWorld 可选字段
 */
export interface ProjectExportData {
  version: number
  exportedAt: number
  project: Omit<Project, 'id'>

  // ── 原有（v1）──
  worldviews: Omit<Worldview, 'id' | 'projectId'>[]
  storyCores: Omit<StoryCore, 'id' | 'projectId'>[]
  powerSystems: Omit<PowerSystem, 'id' | 'projectId'>[]
  characters: Omit<Character, 'id' | 'projectId'>[]
  factions: Omit<Faction, 'id' | 'projectId'>[]
  outlineNodes: (Omit<OutlineNode, 'id' | 'projectId'> & { _exportId: number; _parentExportId: number | null })[]
  chapters: (Omit<Chapter, 'id' | 'projectId' | 'outlineNodeId'> & { _outlineExportId: number })[]
  foreshadows: Omit<Foreshadow, 'id' | 'projectId'>[]
  geographies: Omit<Geography, 'id' | 'projectId'>[]
  histories: Omit<History, 'id' | 'projectId'>[]
  itemSystems: Omit<ItemSystem, 'id' | 'projectId'>[]
  creativeRules: Omit<CreativeRules, 'id' | 'projectId'>[]
  characterRelations: (Omit<CharacterRelation, 'id' | 'projectId' | 'fromCharacterId' | 'toCharacterId'> & {
    _fromCharacterIndex: number
    _toCharacterIndex: number
  })[]

  // ── 新增（v2）──
  detailedOutlines?: (Omit<DetailedOutline, 'id' | 'projectId' | 'outlineNodeId'> & { _outlineExportId: number })[]
  emotionBeatCards?: (Omit<EmotionBeatCard, 'id' | 'projectId' | 'chapterId'> & { _chapterExportId: number })[]
  stateCards?: Omit<StateCard, 'id' | 'projectId'>[]
  storyArcs?: Omit<StoryArc, 'id' | 'projectId'>[]
  worldNodes?: (Omit<WorldNode, 'id' | 'projectId'> & { _exportId: number; _parentExportId: number | null })[]
  notes?: Omit<Note, 'id' | 'projectId'>[]
  references?: (Omit<Reference, 'id' | 'projectId'> & { _exportId: number })[]
  referenceChunkAnalysis?: (Omit<ReferenceChunkAnalysis, 'id' | 'referenceId'> & { _referenceExportId: number })[]
  historicalTimelineEvents?: Omit<HistoricalTimelineEvent, 'id' | 'projectId'>[]
  historicalKeywords?: Omit<HistoricalKeyword, 'id' | 'projectId'>[]
  masterWorks?: (Omit<MasterWork, 'id'> & { _exportId: number })[]
  masterChunkAnalysis?: (Omit<MasterChunkAnalysis, 'id' | 'workId'> & { _workExportId: number })[]
  masterChapterBeats?: (Omit<MasterChapterBeat, 'id' | 'workId'> & { _workExportId: number })[]
  masterStyleMetrics?: (Omit<MasterStyleMetrics, 'id' | 'workId'> & { _workExportId: number })[]
  masterInsights?: Omit<MasterInsight, 'id'>[]

  // ── v3: 多世界系统（Phase 25.4）──
  worldGroups?: (Omit<WorldGroup, 'id' | 'projectId'> & { _exportId: number })[]
  worldGroupLinks?: (Omit<WorldGroupLink, 'id' | 'projectId' | 'fromGroupId' | 'toGroupId'> & {
    _fromGroupExportId: number
    _toGroupExportId: number
  })[]

  // ── v3: 物品流水（Phase 25.5.2-b，chapterId 可空）──
  itemLedger?: (Omit<ItemLedgerEntry, 'id' | 'projectId' | 'chapterId'> & { _chapterExportId: number | null })[]
  // ── v3: 故事进程年表（Phase 25.5.2-a，chapterId 可空）──
  storyTimelineEvents?: (Omit<StoryTimelineEvent, 'id' | 'projectId' | 'chapterId'> & { _chapterExportId: number | null })[]

  // ── 此前漏导出（会丢数据），补全 ──
  importantLocations?: (Omit<ImportantLocation, 'id' | 'projectId' | 'parentId'> & { _exportId: number; _parentExportId: number | null })[]
  worldRulesProfiles?: Omit<WorldRulesProfile, 'id' | 'projectId'>[]
  codexCategories?: (Omit<CodexCategory, 'id' | 'projectId' | 'parentId'> & { _exportId: number; _parentExportId: number | null })[]
  codexEntries?: (Omit<CodexEntry, 'id' | 'projectId' | 'categoryId'> & { _categoryExportId: number })[]
}

/** 导出项目为 JSON */
export async function exportProjectJSON(projectId: number): Promise<ProjectExportData> {
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('项目不存在')

  // ── 并行查询所有表 ──
  const [
    worldviews, storyCores, powerSystems,
    characters, factions, outlineNodes, chapters,
    foreshadows, geographies, histories, itemSystems,
    creativeRules, characterRelations,
    // v2 新增
    detailedOutlines, emotionBeatCards, stateCards,
    storyArcs, worldNodes, notes,
    refs, historicalTimelineEvents, historicalKeywords,
    masterWorks, masterInsights,
    // v3
    worldGroups, worldGroupLinks, itemLedger, storyTimelineEvents,
    importantLocations, worldRulesProfiles, codexCategories, codexEntries,
  ] = await Promise.all([
    db.worldviews.where('projectId').equals(projectId).toArray(),
    db.storyCores.where('projectId').equals(projectId).toArray(),
    db.powerSystems.where('projectId').equals(projectId).toArray(),
    db.characters.where('projectId').equals(projectId).toArray(),
    db.factions.where('projectId').equals(projectId).toArray(),
    db.outlineNodes.where('projectId').equals(projectId).toArray(),
    db.chapters.where('projectId').equals(projectId).toArray(),
    db.foreshadows.where('projectId').equals(projectId).toArray(),
    db.geographies.where('projectId').equals(projectId).toArray(),
    db.histories.where('projectId').equals(projectId).toArray(),
    db.itemSystems.where('projectId').equals(projectId).toArray(),
    db.creativeRules.where('projectId').equals(projectId).toArray(),
    db.characterRelations.where('projectId').equals(projectId).toArray(),
    // v2
    db.detailedOutlines.where('projectId').equals(projectId).toArray(),
    db.emotionBeatCards.where('projectId').equals(projectId).toArray(),
    db.stateCards.where('projectId').equals(projectId).toArray(),
    db.storyArcs.where('projectId').equals(projectId).toArray(),
    db.worldNodes.where('projectId').equals(projectId).toArray(),
    db.notes.where('projectId').equals(projectId).toArray(),
    db.references.where('projectId').equals(projectId).toArray(),
    db.historicalTimelineEvents.where('projectId').equals(projectId).toArray(),
    db.historicalKeywords.where('projectId').equals(projectId).toArray(),
    // masterWorks: projectId 可选，取绑定到本项目的 + 全局的
    db.masterWorks.where('projectId').equals(projectId).toArray(),
    // masterInsights 没有 projectId，但按 genre 存储，全部导出
    db.masterInsights.toArray(),
    // v3: 多世界系统
    db.worldGroups.where('projectId').equals(projectId).sortBy('order'),
    db.worldGroupLinks.where('projectId').equals(projectId).toArray(),
    // v3: 物品流水
    db.itemLedger.where('projectId').equals(projectId).toArray(),
    // v3: 故事进程年表
    db.storyTimelineEvents.where('projectId').equals(projectId).toArray(),
    // 补全：此前漏导出会丢数据
    db.importantLocations.where('projectId').equals(projectId).toArray(),
    db.worldRulesProfiles.where('projectId').equals(projectId).toArray(),
    db.codexCategories.where('projectId').equals(projectId).toArray(),
    db.codexEntries.where('projectId').equals(projectId).toArray(),
  ])

  // ── 构建 ID 映射 ──

  // 世界组 ID → 导出序号
  const worldGroupIdMap = new Map<number, number>()
  worldGroups.forEach((g, i) => { if (g.id) worldGroupIdMap.set(g.id, i) })

  // 大纲节点 ID → 导出序号
  const outlineIdMap = new Map<number, number>()
  outlineNodes.forEach((n, i) => { if (n.id) outlineIdMap.set(n.id, i) })

  // 角色 ID → 导出序号
  const charIdMap = new Map<number, number>()
  characters.forEach((c, i) => { if (c.id) charIdMap.set(c.id, i) })

  // 章节 ID → 导出序号
  const chapterIdMap = new Map<number, number>()
  chapters.forEach((ch, i) => { if (ch.id) chapterIdMap.set(ch.id, i) })

  // 世界节点 ID → 导出序号
  const worldNodeIdMap = new Map<number, number>()
  worldNodes.forEach((w, i) => { if (w.id) worldNodeIdMap.set(w.id, i) })

  // 重要地点 ID → 导出序号（树）
  const locationIdMap = new Map<number, number>()
  importantLocations.forEach((l, i) => { if (l.id) locationIdMap.set(l.id, i) })

  // 词条分类 ID → 导出序号（树 + 被词条引用）
  const codexCatIdMap = new Map<number, number>()
  codexCategories.forEach((c, i) => { if (c.id) codexCatIdMap.set(c.id, i) })

  // 参考书目 ID → 导出序号
  const refIdMap = new Map<number, number>()
  refs.forEach((r, i) => { if (r.id) refIdMap.set(r.id, i) })

  // 作品学习 ID → 导出序号
  const masterWorkIdMap = new Map<number, number>()
  masterWorks.forEach((w, i) => { if (w.id) masterWorkIdMap.set(w.id, i) })

  // ── 查询依赖其他 ID 的子表 ──
  const refIds = refs.map(r => r.id!).filter(Boolean)
  const masterWorkIds = masterWorks.map(w => w.id!).filter(Boolean)

  const [refChunkAnalysis, masterChunks, masterBeats, masterStyles] = await Promise.all([
    refIds.length > 0
      ? db.referenceChunkAnalysis.where('referenceId').anyOf(refIds).toArray()
      : Promise.resolve([]),
    masterWorkIds.length > 0
      ? db.masterChunkAnalysis.where('workId').anyOf(masterWorkIds).toArray()
      : Promise.resolve([]),
    masterWorkIds.length > 0
      ? db.masterChapterBeats.where('workId').anyOf(masterWorkIds).toArray()
      : Promise.resolve([]),
    masterWorkIds.length > 0
      ? db.masterStyleMetrics.where('workId').anyOf(masterWorkIds).toArray()
      : Promise.resolve([]),
  ])

  // ── 组装导出数据 ──

  const { id: _pid, ...projectData } = project

  return {
    version: 3,
    exportedAt: Date.now(),
    project: projectData,

    // ── v1 原有 ──
    worldviews: worldviews.map(({ id: _, projectId: __, ...rest }) => rest),
    storyCores: storyCores.map(({ id: _, projectId: __, ...rest }) => rest),
    powerSystems: powerSystems.map(({ id: _, projectId: __, ...rest }) => rest),
    characters: characters.map(({ id: _, projectId: __, ...rest }) => rest),
    factions: factions.map(({ id: _, projectId: __, ...rest }) => rest),
    outlineNodes: outlineNodes.map((n) => {
      const { id, projectId: __, ...rest } = n
      return {
        ...rest,
        _exportId: outlineIdMap.get(id!) ?? 0,
        _parentExportId: n.parentId ? (outlineIdMap.get(n.parentId) ?? null) : null,
      }
    }),
    chapters: chapters.map((ch) => {
      const { id: _, projectId: __, outlineNodeId, ...rest } = ch
      return {
        ...rest,
        _outlineExportId: outlineIdMap.get(outlineNodeId) ?? 0,
      }
    }),
    foreshadows: foreshadows.map(({ id: _, projectId: __, ...rest }) => rest),
    geographies: geographies.map(({ id: _, projectId: __, ...rest }) => rest),
    histories: histories.map(({ id: _, projectId: __, ...rest }) => rest),
    itemSystems: itemSystems.map(({ id: _, projectId: __, ...rest }) => rest),
    creativeRules: creativeRules.map(({ id: _, projectId: __, ...rest }) => rest),
    characterRelations: characterRelations.map((r) => {
      const { id: _, projectId: __, fromCharacterId, toCharacterId, ...rest } = r
      return {
        ...rest,
        _fromCharacterIndex: charIdMap.get(fromCharacterId) ?? -1,
        _toCharacterIndex: charIdMap.get(toCharacterId) ?? -1,
      }
    }),

    // ── v2 新增 ──
    detailedOutlines: detailedOutlines.map((d) => {
      const { id: _, projectId: __, outlineNodeId, ...rest } = d
      return { ...rest, _outlineExportId: outlineIdMap.get(outlineNodeId) ?? 0 }
    }),
    emotionBeatCards: emotionBeatCards.map((e) => {
      const { id: _, projectId: __, chapterId, ...rest } = e
      return { ...rest, _chapterExportId: chapterIdMap.get(chapterId) ?? 0 }
    }),
    stateCards: stateCards.map(({ id: _, projectId: __, ...rest }) => rest),
    storyArcs: storyArcs.map(({ id: _, projectId: __, ...rest }) => rest),
    worldNodes: worldNodes.map((w) => {
      const { id, projectId: __, ...rest } = w
      return {
        ...rest,
        _exportId: worldNodeIdMap.get(id!) ?? 0,
        _parentExportId: w.parentId ? (worldNodeIdMap.get(w.parentId) ?? null) : null,
      }
    }),
    notes: notes.map(({ id: _, projectId: __, ...rest }) => rest),
    references: refs.map((r) => {
      const { id, projectId: __, ...rest } = r
      return { ...rest, _exportId: refIdMap.get(id!) ?? 0 }
    }),
    referenceChunkAnalysis: refChunkAnalysis.map((a) => {
      const { id: _, referenceId, ...rest } = a
      return { ...rest, _referenceExportId: refIdMap.get(referenceId) ?? 0 }
    }),
    historicalTimelineEvents: historicalTimelineEvents.map(({ id: _, projectId: __, ...rest }) => rest),
    historicalKeywords: historicalKeywords.map(({ id: _, projectId: __, ...rest }) => rest),
    masterWorks: masterWorks.map((w) => {
      const { id, ...rest } = w
      return { ...rest, _exportId: masterWorkIdMap.get(id!) ?? 0 }
    }),
    masterChunkAnalysis: masterChunks.map((a) => {
      const { id: _, workId, ...rest } = a
      return { ...rest, _workExportId: masterWorkIdMap.get(workId) ?? 0 }
    }),
    masterChapterBeats: masterBeats.map((b) => {
      const { id: _, workId, ...rest } = b
      return { ...rest, _workExportId: masterWorkIdMap.get(workId) ?? 0 }
    }),
    masterStyleMetrics: masterStyles.map((s) => {
      const { id: _, workId, ...rest } = s
      return { ...rest, _workExportId: masterWorkIdMap.get(workId) ?? 0 }
    }),
    masterInsights: masterInsights.map(({ id: _, ...rest }) => rest),

    // v3: 多世界系统
    worldGroups: worldGroups.map(({ id, projectId: _, ...rest }) => ({
      ...rest,
      _exportId: worldGroupIdMap.get(id!) ?? 0,
    })),
    worldGroupLinks: worldGroupLinks.map(({ id: _, projectId: _p, fromGroupId, toGroupId, ...rest }) => ({
      ...rest,
      _fromGroupExportId: worldGroupIdMap.get(fromGroupId) ?? 0,
      _toGroupExportId: worldGroupIdMap.get(toGroupId) ?? 0,
    })),
    itemLedger: itemLedger.map(({ id: _, projectId: _p, chapterId, ...rest }) => ({
      ...rest,
      _chapterExportId: chapterId != null ? (chapterIdMap.get(chapterId) ?? null) : null,
    })),
    storyTimelineEvents: storyTimelineEvents.map(({ id: _, projectId: _p, chapterId, ...rest }) => ({
      ...rest,
      _chapterExportId: chapterId != null ? (chapterIdMap.get(chapterId) ?? null) : null,
    })),
    // 补全：此前漏导出会丢数据
    importantLocations: importantLocations.map(({ id: _, projectId: _p, parentId, ...rest }, i) => ({
      ...rest,
      _exportId: i,
      _parentExportId: parentId != null ? (locationIdMap.get(parentId) ?? null) : null,
    })),
    worldRulesProfiles: worldRulesProfiles.map(({ id: _, projectId: _p, ...rest }) => rest),
    codexCategories: codexCategories.map(({ id: _, projectId: _p, parentId, ...rest }, i) => ({
      ...rest,
      _exportId: i,
      _parentExportId: parentId != null ? (codexCatIdMap.get(parentId) ?? null) : null,
    })),
    codexEntries: codexEntries.map(({ id: _, projectId: _p, categoryId, ...rest }) => ({
      ...rest,
      _categoryExportId: codexCatIdMap.get(categoryId) ?? 0,
    })),
  }
}

/** 下载 JSON 文件 */
export function downloadJSON(data: ProjectExportData, filename: string) {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 导入项目 JSON — 返回新项目 ID（兼容 v1 和 v2 格式） */
export async function importProjectJSON(data: ProjectExportData): Promise<number> {
  if (!data.version || !data.project) {
    throw new Error('无效的导出文件格式')
  }

  const now = Date.now()

  // 1. 创建项目
  const newProjectId = await db.projects.add({
    ...data.project,
    name: `${data.project.name}（导入）`,
    createdAt: now,
    updatedAt: now,
  } as Project) as number

  // 2. 导入世界观相关
  for (const w of data.worldviews || []) {
    await db.worldviews.add({ ...w, projectId: newProjectId } as Worldview)
  }
  for (const sc of data.storyCores || []) {
    await db.storyCores.add({ ...sc, projectId: newProjectId } as StoryCore)
  }
  for (const ps of data.powerSystems || []) {
    await db.powerSystems.add({ ...ps, projectId: newProjectId } as PowerSystem)
  }

  // 3. 导入角色（记录新旧 ID 映射）
  const newCharIds = new Map<number, number>()
  for (let i = 0; i < (data.characters || []).length; i++) {
    const c = data.characters[i]
    const newId = await db.characters.add({ ...c, projectId: newProjectId } as Character) as number
    newCharIds.set(i, newId)
  }

  // 4. 导入势力
  for (const f of data.factions || []) {
    await db.factions.add({ ...f, projectId: newProjectId } as Faction)
  }

  // 5. 导入大纲节点（重建 parentId）
  const newOutlineIds = new Map<number, number>()
  const sortedNodes = [...(data.outlineNodes || [])].sort((a, b) => {
    if (a._parentExportId === null && b._parentExportId !== null) return -1
    if (a._parentExportId !== null && b._parentExportId === null) return 1
    return (a._exportId ?? 0) - (b._exportId ?? 0)
  })
  for (const n of sortedNodes) {
    const { _exportId, _parentExportId, parentId: _, ...rest } = n
    const newParentId = _parentExportId !== null ? (newOutlineIds.get(_parentExportId) ?? null) : null
    const newId = await db.outlineNodes.add({
      ...rest,
      parentId: newParentId,
      projectId: newProjectId,
    } as OutlineNode) as number
    newOutlineIds.set(_exportId, newId)
  }

  // 6. 导入章节（重建 outlineNodeId，记录新旧 ID）
  const newChapterIds = new Map<number, number>()
  for (let i = 0; i < (data.chapters || []).length; i++) {
    const ch = data.chapters[i]
    const { _outlineExportId, ...rest } = ch
    const newOutlineNodeId = newOutlineIds.get(_outlineExportId) ?? 0
    const newId = await db.chapters.add({
      ...rest,
      outlineNodeId: newOutlineNodeId,
      projectId: newProjectId,
    } as Chapter) as number
    newChapterIds.set(i, newId)
  }

  // 7. 导入伏笔
  for (const f of data.foreshadows || []) {
    await db.foreshadows.add({ ...f, projectId: newProjectId } as Foreshadow)
  }

  // 8. 导入其他基础模块
  for (const g of data.geographies || []) {
    await db.geographies.add({ ...g, projectId: newProjectId } as Geography)
  }
  for (const h of data.histories || []) {
    await db.histories.add({ ...h, projectId: newProjectId } as History)
  }
  for (const item of data.itemSystems || []) {
    await db.itemSystems.add({ ...item, projectId: newProjectId } as ItemSystem)
  }
  for (const cr of data.creativeRules || []) {
    await db.creativeRules.add({ ...cr, projectId: newProjectId } as CreativeRules)
  }

  // 9. 导入角色关系（重建 fromCharacterId/toCharacterId）
  for (const r of data.characterRelations || []) {
    const { _fromCharacterIndex, _toCharacterIndex, ...rest } = r
    const fromId = newCharIds.get(_fromCharacterIndex)
    const toId = newCharIds.get(_toCharacterIndex)
    if (fromId && toId) {
      await db.characterRelations.add({
        ...rest,
        fromCharacterId: fromId,
        toCharacterId: toId,
        projectId: newProjectId,
      } as CharacterRelation)
    }
  }

  // ── v2 新增表（向后兼容：字段不存在时跳过） ──

  // 10. 细纲（重建 outlineNodeId）
  for (const d of data.detailedOutlines || []) {
    const { _outlineExportId, ...rest } = d
    const newOutlineNodeId = newOutlineIds.get(_outlineExportId) ?? 0
    await db.detailedOutlines.add({
      ...rest,
      outlineNodeId: newOutlineNodeId,
      projectId: newProjectId,
    } as DetailedOutline)
  }

  // 11. 情感节拍卡（重建 chapterId）
  for (const e of data.emotionBeatCards || []) {
    const { _chapterExportId, ...rest } = e
    const newChapterId = newChapterIds.get(_chapterExportId) ?? 0
    await db.emotionBeatCards.add({
      ...rest,
      chapterId: newChapterId,
      projectId: newProjectId,
    } as EmotionBeatCard)
  }

  // 12. 状态表
  for (const s of data.stateCards || []) {
    await db.stateCards.add({ ...s, projectId: newProjectId } as StateCard)
  }

  // 13. 故事线
  for (const a of data.storyArcs || []) {
    await db.storyArcs.add({ ...a, projectId: newProjectId } as StoryArc)
  }

  // 14. 世界节点（重建 parentId）
  const newWorldNodeIds = new Map<number, number>()
  const sortedWorldNodes = [...(data.worldNodes || [])].sort((a, b) => {
    if (a._parentExportId === null && b._parentExportId !== null) return -1
    if (a._parentExportId !== null && b._parentExportId === null) return 1
    return (a._exportId ?? 0) - (b._exportId ?? 0)
  })
  for (const w of sortedWorldNodes) {
    const { _exportId, _parentExportId, parentId: _, ...rest } = w
    const newParentId = _parentExportId !== null ? (newWorldNodeIds.get(_parentExportId) ?? null) : null
    const newId = await db.worldNodes.add({
      ...rest,
      parentId: newParentId,
      projectId: newProjectId,
    } as WorldNode) as number
    newWorldNodeIds.set(_exportId, newId)
  }

  // 15. 便签
  for (const n of data.notes || []) {
    await db.notes.add({ ...n, projectId: newProjectId } as Note)
  }

  // 16. 参考书目（记录新旧 ID）
  const newRefIds = new Map<number, number>()
  for (const r of data.references || []) {
    const { _exportId, ...rest } = r
    const newId = await db.references.add({
      ...rest,
      projectId: newProjectId,
    } as Reference) as number
    newRefIds.set(_exportId, newId)
  }

  // 17. 参考书目分块分析（重建 referenceId）
  for (const a of data.referenceChunkAnalysis || []) {
    const { _referenceExportId, ...rest } = a
    const newRefId = newRefIds.get(_referenceExportId)
    if (newRefId) {
      await db.referenceChunkAnalysis.add({
        ...rest,
        referenceId: newRefId,
      } as ReferenceChunkAnalysis)
    }
  }

  // 18. 历史时间轴事件
  for (const e of data.historicalTimelineEvents || []) {
    await db.historicalTimelineEvents.add({ ...e, projectId: newProjectId } as HistoricalTimelineEvent)
  }

  // 19. 历史关键词
  for (const k of data.historicalKeywords || []) {
    await db.historicalKeywords.add({ ...k, projectId: newProjectId } as HistoricalKeyword)
  }

  // 20. 作品学习（记录新旧 ID）
  const newMasterWorkIds = new Map<number, number>()
  for (const w of data.masterWorks || []) {
    const { _exportId, ...rest } = w
    const newId = await db.masterWorks.add({
      ...rest,
      projectId: newProjectId,
    } as MasterWork) as number
    newMasterWorkIds.set(_exportId, newId)
  }

  // 21. 作品学习分块分析（重建 workId）
  for (const a of data.masterChunkAnalysis || []) {
    const { _workExportId, ...rest } = a
    const newWorkId = newMasterWorkIds.get(_workExportId)
    if (newWorkId) {
      await db.masterChunkAnalysis.add({ ...rest, workId: newWorkId } as MasterChunkAnalysis)
    }
  }

  // 22. 章节节奏点（重建 workId）
  for (const b of data.masterChapterBeats || []) {
    const { _workExportId, ...rest } = b
    const newWorkId = newMasterWorkIds.get(_workExportId)
    if (newWorkId) {
      await db.masterChapterBeats.add({ ...rest, workId: newWorkId } as MasterChapterBeat)
    }
  }

  // 23. 风格量化（重建 workId）
  for (const s of data.masterStyleMetrics || []) {
    const { _workExportId, ...rest } = s
    const newWorkId = newMasterWorkIds.get(_workExportId)
    if (newWorkId) {
      await db.masterStyleMetrics.add({ ...rest, workId: newWorkId } as MasterStyleMetrics)
    }
  }

  // 24. 大师洞察（全局，不绑定 projectId）
  for (const i of data.masterInsights || []) {
    // 按 genre 去重：如果已有同 genre 的洞察则跳过
    if (i.genre) {
      const existing = await db.masterInsights.where('genre').equals(i.genre).first()
      if (existing) continue
    }
    await db.masterInsights.add(i as MasterInsight)
  }

  // 25. 世界组（v3，Phase 25.4）
  const newWorldGroupIds = new Map<number, number>()
  for (const g of data.worldGroups || []) {
    const { _exportId, ...rest } = g
    const newId = await db.worldGroups.add({
      ...rest,
      projectId: newProjectId,
    } as WorldGroup) as number
    newWorldGroupIds.set(_exportId, newId)
  }

  // 26. 世界组关系
  for (const l of data.worldGroupLinks || []) {
    const { _fromGroupExportId, _toGroupExportId, ...rest } = l
    const fromId = newWorldGroupIds.get(_fromGroupExportId)
    const toId = newWorldGroupIds.get(_toGroupExportId)
    if (fromId && toId) {
      await db.worldGroupLinks.add({
        ...rest,
        projectId: newProjectId,
        fromGroupId: fromId,
        toGroupId: toId,
      } as WorldGroupLink)
    }
  }

  // 26.5 物品流水（v3，chapterId 重映射）
  for (const e of data.itemLedger || []) {
    const { _chapterExportId, ...rest } = e
    const newChapterId = _chapterExportId != null ? (newChapterIds.get(_chapterExportId) ?? null) : null
    await db.itemLedger.add({
      ...rest,
      projectId: newProjectId,
      chapterId: newChapterId,
    } as ItemLedgerEntry)
  }

  // 26.6 故事进程年表（v3，chapterId 重映射）
  for (const e of data.storyTimelineEvents || []) {
    const { _chapterExportId, ...rest } = e
    const newChapterId = _chapterExportId != null ? (newChapterIds.get(_chapterExportId) ?? null) : null
    await db.storyTimelineEvents.add({
      ...rest,
      projectId: newProjectId,
      chapterId: newChapterId,
    } as StoryTimelineEvent)
  }

  // 26.7 重要地点（树，重建 parentId）—— 此前漏导入
  const newLocationIds = new Map<number, number>()
  const sortedLocs = [...(data.importantLocations || [])].sort((a, b) => {
    if (a._parentExportId === null && b._parentExportId !== null) return -1
    if (a._parentExportId !== null && b._parentExportId === null) return 1
    return (a._exportId ?? 0) - (b._exportId ?? 0)
  })
  for (const l of sortedLocs) {
    const { _exportId, _parentExportId, ...rest } = l
    const newParentId = _parentExportId !== null ? (newLocationIds.get(_parentExportId) ?? null) : null
    const newId = await db.importantLocations.add({
      ...rest, parentId: newParentId, projectId: newProjectId,
    } as ImportantLocation) as number
    newLocationIds.set(_exportId, newId)
  }

  // 26.8 真实与幻想（世界规则）—— 此前漏导入
  for (const p of data.worldRulesProfiles || []) {
    await db.worldRulesProfiles.add({ ...p, projectId: newProjectId } as WorldRulesProfile)
  }

  // 26.9 词条分类（树，重建 parentId）—— 此前漏导入
  const newCodexCatIds = new Map<number, number>()
  const sortedCats = [...(data.codexCategories || [])].sort((a, b) => {
    if (a._parentExportId === null && b._parentExportId !== null) return -1
    if (a._parentExportId !== null && b._parentExportId === null) return 1
    return (a._exportId ?? 0) - (b._exportId ?? 0)
  })
  for (const c of sortedCats) {
    const { _exportId, _parentExportId, ...rest } = c
    const newParentId = _parentExportId !== null ? (newCodexCatIds.get(_parentExportId) ?? null) : null
    const newId = await db.codexCategories.add({
      ...rest, parentId: newParentId, projectId: newProjectId,
    } as CodexCategory) as number
    newCodexCatIds.set(_exportId, newId)
  }

  // 26.10 词条（重建 categoryId）—— 此前漏导入
  for (const e of data.codexEntries || []) {
    const { _categoryExportId, ...rest } = e
    const newCategoryId = newCodexCatIds.get(_categoryExportId)
    if (newCategoryId == null) continue
    await db.codexEntries.add({
      ...rest, categoryId: newCategoryId, projectId: newProjectId,
    } as CodexEntry)
  }

  // 27. 重映射所有 worldGroupId 引用
  // 导入的记录里 worldGroupId 还指向旧 ID，需要：
  //   - 旧 ID 在映射表中 → 替换为新 ID
  //   - 旧 ID 不在映射表（孤立引用，或没导入世界组）→ 清为 null
  //     （否则旧 ID 可能撞上本项目自增产生的新世界组 ID，导致数据错乱）
  const remap = (oldId: number | null | undefined): number | null => {
    if (oldId === null || oldId === undefined) return null
    return newWorldGroupIds.get(oldId) ?? null
  }

  // worldviews
  const allWv = await db.worldviews.where('projectId').equals(newProjectId).toArray()
  for (const wv of allWv) {
    if (wv.worldGroupId !== undefined && wv.worldGroupId !== null) {
      await db.worldviews.update(wv.id!, { worldGroupId: remap(wv.worldGroupId) })
    }
  }
  // powerSystems
  const allPs = await db.powerSystems.where('projectId').equals(newProjectId).toArray()
  for (const ps of allPs) {
    if (ps.worldGroupId !== undefined && ps.worldGroupId !== null) {
      await db.powerSystems.update(ps.id!, { worldGroupId: remap(ps.worldGroupId) })
    }
  }
  // characters homeWorldGroupId
  const allChars = await db.characters.where('projectId').equals(newProjectId).toArray()
  for (const c of allChars) {
    if (c.homeWorldGroupId !== undefined && c.homeWorldGroupId !== null) {
      await db.characters.update(c.id!, { homeWorldGroupId: remap(c.homeWorldGroupId) })
    }
  }
  // outlineNodes worldGroupId
  const allNodes = await db.outlineNodes.where('projectId').equals(newProjectId).toArray()
  for (const n of allNodes) {
    if (n.worldGroupId !== undefined && n.worldGroupId !== null) {
      await db.outlineNodes.update(n.id!, { worldGroupId: remap(n.worldGroupId) })
    }
  }
  // geographies
  const allGeo = await db.geographies.where('projectId').equals(newProjectId).toArray()
  for (const g of allGeo) {
    if (g.worldGroupId !== undefined && g.worldGroupId !== null) {
      await db.geographies.update(g.id!, { worldGroupId: remap(g.worldGroupId) })
    }
  }
  // histories
  const allHist = await db.histories.where('projectId').equals(newProjectId).toArray()
  for (const h of allHist) {
    if (h.worldGroupId !== undefined && h.worldGroupId !== null) {
      await db.histories.update(h.id!, { worldGroupId: remap(h.worldGroupId) })
    }
  }
  // worldNodes
  const allWn = await db.worldNodes.where('projectId').equals(newProjectId).toArray()
  for (const wn of allWn) {
    if (wn.worldGroupId !== undefined && wn.worldGroupId !== null) {
      await db.worldNodes.update(wn.id!, { worldGroupId: remap(wn.worldGroupId) })
    }
  }
  // historicalTimelineEvents
  const allHte = await db.historicalTimelineEvents.where('projectId').equals(newProjectId).toArray()
  for (const e of allHte) {
    if (e.worldGroupId !== undefined && e.worldGroupId !== null) {
      await db.historicalTimelineEvents.update(e.id!, { worldGroupId: remap(e.worldGroupId) })
    }
  }
  // historicalKeywords
  const allHk = await db.historicalKeywords.where('projectId').equals(newProjectId).toArray()
  for (const k of allHk) {
    if (k.worldGroupId !== undefined && k.worldGroupId !== null) {
      await db.historicalKeywords.update(k.id!, { worldGroupId: remap(k.worldGroupId) })
    }
  }
  // codexCategories worldGroupId
  const allCc = await db.codexCategories.where('projectId').equals(newProjectId).toArray()
  for (const c of allCc) {
    if (c.worldGroupId !== undefined && c.worldGroupId !== null) {
      await db.codexCategories.update(c.id!, { worldGroupId: remap(c.worldGroupId) })
    }
  }
  // codexEntries worldGroupId
  const allCe = await db.codexEntries.where('projectId').equals(newProjectId).toArray()
  for (const e of allCe) {
    if (e.worldGroupId !== undefined && e.worldGroupId !== null) {
      await db.codexEntries.update(e.id!, { worldGroupId: remap(e.worldGroupId) })
    }
  }

  return newProjectId
}
