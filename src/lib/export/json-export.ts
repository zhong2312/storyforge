/**
 * 项目 JSON 导出/导入 · 对外门面
 *
 * AUDIT-1 后:导出/导入主体已由注册表派生(registry-export.ts / registry-import.ts),
 * 本文件只保留「导出格式契约类型 ProjectExportData」+「对外 API 门面」+「下载工具」。
 * 加新表 = 在 PROJECT_TABLES 登记一行即自动进出导出,无需再手改本文件。
 *
 * 行为等价/兼容由测试锁死:
 *   R-export-derive-equivalence(派生 ≡ 旧手写,逐字段)
 *   R-export-derive-roundtrip(派生往返 + 新旧交叉)
 *   R-export-fullcoverage(全表多世界往返)
 *   R-export-legacy-fixture(派生导入真实旧格式 fixture)
 */
import { deriveExportProjectJSON } from './registry-export'
import { deriveImportProjectJSON } from './registry-import'
import type {
  Project, Worldview, StoryCore, PowerSystem,
  Character, OutlineNode, Chapter,
  Foreshadow, Geography, History,
  CreativeRules, CharacterRelation,
  DetailedOutline, EmotionBeatCard, StateCard,
  StoryArc, WorldNode, Note,
  Reference, ReferenceChunkAnalysis,
  HistoricalTimelineEvent, HistoricalKeyword,
  WorldGroup, WorldGroupLink, ItemLedgerEntry, StoryTimelineEvent,
  ImportantLocation, WorldRulesProfile, CodexCategory, CodexEntry,
  UserStyleProfile,
} from '../types'
import type { TemporalFact } from '../types/temporal-fact'

type WorldGroupExportRef = {
  _worldGroupExportId?: number | null
  /** Legacy export compatibility only. New exports should not write this field. */
  worldGroupId?: number | null
}

type HomeWorldGroupExportRef = {
  _homeWorldGroupExportId?: number | null
  /** Legacy export compatibility only. New exports should not write this field. */
  homeWorldGroupId?: number | null
}

/**
 * 完整项目导出数据结构(导出格式契约)
 *
 * version 历史：
 *   1 — 初始版本（14 张表）
 *   2 — 补全全部项目数据（2026-05-27）
 *   3 — 多世界系统（2026-06-02，Phase 25.4）
 */
export interface ProjectExportData {
  version: number
  exportedAt: number
  project: Omit<Project, 'id'>

  // ── 原有（v1）──
  worldviews: (Omit<Worldview, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef)[]
  storyCores: Omit<StoryCore, 'id' | 'projectId'>[]
  powerSystems: (Omit<PowerSystem, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef)[]
  characters: (Omit<Character, 'id' | 'projectId' | 'homeWorldGroupId'> & HomeWorldGroupExportRef)[]
  outlineNodes: (Omit<OutlineNode, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef & { _exportId: number; _parentExportId: number | null })[]
  chapters: (Omit<Chapter, 'id' | 'projectId' | 'outlineNodeId'> & { _outlineExportId: number })[]
  foreshadows: Omit<Foreshadow, 'id' | 'projectId'>[]
  geographies: (Omit<Geography, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef)[]
  histories: (Omit<History, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef)[]
  creativeRules: Omit<CreativeRules, 'id' | 'projectId'>[]
  characterRelations: (Omit<CharacterRelation, 'id' | 'projectId' | 'fromCharacterId' | 'toCharacterId'> & {
    _fromCharacterIndex: number
    _toCharacterIndex: number
  })[]

  // ── 新增（v2）──
  detailedOutlines?: (Omit<DetailedOutline, 'id' | 'projectId' | 'outlineNodeId'> & { _outlineExportId: number })[]
  emotionBeatCards?: (Omit<EmotionBeatCard, 'id' | 'projectId' | 'chapterId'> & { _chapterExportId: number })[]
  stateCards?: Omit<StateCard, 'id' | 'projectId'>[]
  /** FB-5 文风画像(每项目单例) */
  userStyleProfiles?: Omit<UserStyleProfile, 'id' | 'projectId'>[]
  /** NS-4 时序事实账本(各 FK 在派生导出里被 remap 成 _xxxExportId) */
  temporalFacts?: (Omit<TemporalFact, 'id' | 'projectId'> & Record<string, unknown>)[]
  storyArcs?: Omit<StoryArc, 'id' | 'projectId'>[]
  worldNodes?: (Omit<WorldNode, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef & { _exportId: number; _parentExportId: number | null })[]
  notes?: Omit<Note, 'id' | 'projectId'>[]
  references?: (Omit<Reference, 'id' | 'projectId'> & { _exportId: number })[]
  referenceChunkAnalysis?: (Omit<ReferenceChunkAnalysis, 'id' | 'referenceId'> & { _referenceExportId: number })[]
  historicalTimelineEvents?: (Omit<HistoricalTimelineEvent, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef)[]
  historicalKeywords?: (Omit<HistoricalKeyword, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef)[]

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
  worldRulesProfiles?: (Omit<WorldRulesProfile, 'id' | 'projectId' | 'worldGroupId'> & WorldGroupExportRef)[]
  codexCategories?: (Omit<CodexCategory, 'id' | 'projectId' | 'parentId' | 'worldGroupId'> & WorldGroupExportRef & { _exportId: number; _parentExportId: number | null })[]
  codexEntries?: (Omit<CodexEntry, 'id' | 'projectId' | 'categoryId' | 'worldGroupId'> & WorldGroupExportRef & { _categoryExportId: number })[]
}

/** 导出项目为 JSON(注册表派生) */
export async function exportProjectJSON(projectId: number): Promise<ProjectExportData> {
  return deriveExportProjectJSON(projectId)
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

/** 导入项目 JSON — 返回新项目 ID（注册表派生，兼容 v1/v2/v3 旧格式） */
export async function importProjectJSON(data: ProjectExportData): Promise<number> {
  return deriveImportProjectJSON(data)
}
