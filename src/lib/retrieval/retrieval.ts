/**
 * NS-5 · 叙事感知混合检索（关键词通道 + 可选 embedding 通道）。
 *
 * 设计 §22.8 NS-5。本模块负责：
 * - 把章节正文切块、抽实体关键词、写入 retrievalChunks（可重建缓存，按 sourceTextHash 失效重建）；
 * - 按"当前章需要"召回历史块：关键词重叠打分（纯浏览器，无需 embedding）+ 可选 embedding 余弦；
 *   硬过滤：未来章不泄漏（规范章序）、世界隔离、按时间重组；去重、邻接保留、top-K。
 * - embedding 不可用时只走关键词通道（优雅降级）。
 */
import { db } from '../db/schema'
import type { RetrievalChunk } from '../types/retrieval-chunk'
import type { NarrativeSummaryNode } from '../types/narrative-summary'
import { cosineSimilarity } from '../types/retrieval-chunk'
import type { Chapter, EmbeddingConfig, OutlineNode } from '../types'
import { normalizeChapterText, hashChapterText, getChapterDerivedMemoryStatus, sha256Text } from '../ai/chapter-memory/text-normalization'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import { embedTexts, embeddingModelTag, isEmbeddingReady } from '../ai/adapters/embedding-adapter'
import { PROJECT_TABLES } from '../registry/project-tables'
import { FIELD_BY_TARGET } from '../registry/field-registry'
import { DexieProjectStorage } from '../storage/adapters/dexie'
import type { ProjectStoragePort, StorageRecord } from '../storage/ports'
import { htmlToPlainText } from '../utils/html'

const CHUNK_SIZE = 400
const SUMMARY_EXCERPT_CHARS = 220
const ROLLUP_CHARS = 1200

/** 把正文切成定长块（按段落边界尽量不切断）。 */
export function splitIntoChunks(text: string, size = CHUNK_SIZE): string[] {
  const clean = text.trim()
  if (!clean) return []
  const paras = clean.split(/\n+/).map(p => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let buf = ''
  for (const p of paras) {
    if ((buf + p).length > size && buf) { chunks.push(buf); buf = '' }
    buf = buf ? `${buf}\n${p}` : p
    while (buf.length > size * 1.6) { chunks.push(buf.slice(0, size)); buf = buf.slice(size) }
  }
  if (buf) chunks.push(buf)
  return chunks
}

/** 抽取出现在块里的已知实体（角色/词条名）作为关键词。 */
export function extractKeywords(text: string, knownEntities: string[]): string[] {
  const found = new Set<string>()
  for (const e of knownEntities) {
    if (e && e.length >= 2 && text.includes(e)) found.add(e)
  }
  return [...found]
}

const RAG_SYSTEM_FIELDS = new Set([
  'id', 'projectId', 'createdAt', 'updatedAt', 'order',
  'worldGroupId', 'homeWorldGroupId', 'chapterId', 'sourceChapterId',
])
const TENTATIVE_RAG_TABLES = new Set(['chapterRevisions', 'plotSimulationSessions', 'plotSimulationTurns'])

export interface ProjectRagDocument {
  sourceTable: string
  sourceRecordId: number
  sourceTitle: string
  sourceChapterId: number
  worldGroupId: number | null
  chunkIndex: number
  text: string
  keywords: string[]
  sourceTextHash: string
}

export interface ProjectRagSearchHit extends ProjectRagDocument {
  score: number
}

/** RAG 覆盖范围直接从 PROJECT_TABLES 派生，不维护第二份业务表清单。 */
export function projectRagSourceTables(): string[] {
  return PROJECT_TABLES
    .filter(spec => spec.exportable && spec.owner !== 'global')
    .map(spec => spec.name)
}

/**
 * 把全部可导出项目数据投影成统一检索文档。
 * 字段优先使用 FIELD_REGISTRY 的 canonical 顺序和中文别名，其余业务字段递归序列化补齐。
 */
export async function buildProjectRagDocuments(args: {
  projectId: number
  storage?: ProjectStoragePort
  sourceTables?: readonly string[]
}): Promise<ProjectRagDocument[]> {
  const storage = args.storage ?? new DexieProjectStorage({ backend: 'dexie', projectId: args.projectId })
  const allowed = new Set(projectRagSourceTables())
  const selected = args.sourceTables?.length
    ? [...new Set(args.sourceTables)].filter(table => allowed.has(table))
    : [...allowed]
  const scopeMetadata = await loadProjectRagScopeMetadata(storage)
  const documents: ProjectRagDocument[] = []

  for (const table of selected) {
    const rows = await storage.table<StorageRecord & Record<string, unknown>>(table).list()
    for (const row of rows) {
      if (row.id == null) continue
      const projected = projectRagRecord(table, row, scopeMetadata)
      if (!projected.text) continue
      const sourceTextHash = await sha256Text(projected.text)
      const pieces = splitIntoChunks(projected.text)
      pieces.forEach((text, chunkIndex) => documents.push({
        sourceTable: table,
        sourceRecordId: row.id!,
        sourceTitle: projected.title,
        sourceChapterId: projected.sourceChapterId,
        worldGroupId: projected.worldGroupId,
        chunkIndex,
        text,
        keywords: extractSearchTerms(`${projected.title} ${text}`).slice(0, 80),
        sourceTextHash,
      }))
    }
  }
  return documents
}

/** 对当前项目实时投影后检索，保证 Agent 不依赖可能过期的缓存。 */
export async function searchProjectRag(args: {
  projectId: number
  storage?: ProjectStoragePort
  query: string
  sourceTables?: readonly string[]
  worldGroupId?: number | null
  currentChapterId?: number | null
  topK?: number
  queryEmbedding?: number[] | null
  queryEmbeddingModel?: string | null
}): Promise<ProjectRagSearchHit[]> {
  const query = args.query.trim()
  if (!query) return []
  const sourceTables = args.sourceTables?.length
    ? args.sourceTables
    : projectRagSourceTables().filter(table => !TENTATIVE_RAG_TABLES.has(table))
  const documents = await buildProjectRagDocuments({ ...args, sourceTables })
  const terms = extractSearchTerms(query)
  const queryNormalized = normalizeSearchText(query)
  const chapterOrder = args.currentChapterId != null
    ? await loadChapterOrder(args.projectId, args.storage)
    : null
  const currentOrder = args.currentChapterId != null ? chapterOrder?.get(args.currentChapterId) : undefined
  if (args.currentChapterId != null && currentOrder == null) return []
  const semanticByDocument = await loadProjectRagSemanticScores(args, documents)
  const hits: ProjectRagSearchHit[] = []

  for (const document of documents) {
    if (document.worldGroupId != null
      && args.worldGroupId !== undefined
      && document.worldGroupId !== (args.worldGroupId ?? null)) continue
    if (currentOrder != null && document.sourceChapterId > 0) {
      const sourceOrder = chapterOrder?.get(document.sourceChapterId)
      if (sourceOrder == null || sourceOrder >= currentOrder) continue
    }
    const normalizedText = normalizeSearchText(document.text)
    const normalizedTitle = normalizeSearchText(document.sourceTitle)
    let score = queryNormalized.length >= 2 && normalizedText.includes(queryNormalized) ? 8 : 0
    for (const term of terms) {
      if (normalizedTitle.includes(term)) score += 3
      if (document.keywords.includes(term)) score += 2
      else if (normalizedText.includes(term)) score += 1
    }
    score += semanticByDocument.get(ragDocumentKey(document)) ?? 0
    if (score > 0) hits.push({ ...document, score })
  }

  const topK = Math.min(20, Math.max(1, Math.trunc(args.topK ?? 8)))
  return hits
    .sort((left, right) => right.score - left.score
      || left.sourceTable.localeCompare(right.sourceTable)
      || left.sourceRecordId - right.sourceRecordId
      || left.chunkIndex - right.chunkIndex)
    .slice(0, topK)
}

export function formatProjectRagHits(query: string, hits: readonly ProjectRagSearchHit[]): string {
  if (!hits.length) return ''
  return [
    `【全项目 RAG 检索：${query.trim()}】`,
    ...hits.map(hit => [
      `- [${hit.sourceTable}#${hit.sourceRecordId}] ${hit.sourceTitle}（相关度 ${hit.score.toFixed(1)}）`,
      `  ${hit.text.replace(/\s+/g, ' ').trim()}`,
    ].join('\n')),
  ].join('\n')
}

async function loadProjectRagSemanticScores(
  args: {
    projectId: number
    storage?: ProjectStoragePort
    queryEmbedding?: number[] | null
    queryEmbeddingModel?: string | null
  },
  documents: readonly ProjectRagDocument[],
): Promise<Map<string, number>> {
  if (!args.queryEmbedding?.length) return new Map()
  const storage = args.storage ?? new DexieProjectStorage({ backend: 'dexie', projectId: args.projectId })
  const current = new Map(documents.map(document => [ragDocumentKey(document), document]))
  const chunks = await storage.table<RetrievalChunk>('retrievalChunks').list()
  const scores = new Map<string, number>()
  for (const chunk of chunks) {
    if (!chunk.embedding?.length || chunk.sourceTable == null || chunk.sourceRecordId == null) continue
    if (args.queryEmbeddingModel && chunk.embeddingModel !== args.queryEmbeddingModel) continue
    const key = `${chunk.sourceTable}:${chunk.sourceRecordId}:${chunk.chunkIndex}`
    const document = current.get(key)
    if (!document || document.sourceTextHash !== chunk.sourceTextHash) continue
    const similarity = cosineSimilarity(args.queryEmbedding, chunk.embedding)
    if (similarity >= 0.25) scores.set(key, similarity * 6)
  }
  return scores
}

function ragDocumentKey(document: Pick<ProjectRagDocument, 'sourceTable' | 'sourceRecordId' | 'chunkIndex'>): string {
  return `${document.sourceTable}:${document.sourceRecordId}:${document.chunkIndex}`
}

function projectRagRecord(
  table: string,
  row: StorageRecord & Record<string, unknown>,
  scopeMetadata: ProjectRagScopeMetadata,
): { title: string; text: string; sourceChapterId: number; worldGroupId: number | null } {
  const title = firstText(row, ['name', 'title', 'label', 'entityName', 'subjectName']) || `${table} #${row.id}`
  const registered = FIELD_BY_TARGET.get(table) ?? []
  const orderedFields = [...new Set([...registered.map(field => field.field), ...Object.keys(row)])]
  const fieldByName = new Map(registered.map(field => [field.field, field] as const))
  const lines: string[] = [`【${table} / ${title}】`]
  for (const field of orderedFields) {
    if (RAG_SYSTEM_FIELDS.has(field)) continue
    const value = row[field]
    const text = ragValueText(value, table === 'chapters' && field === 'content')
    if (!text) continue
    const spec = fieldByName.get(field)
    const label = spec?.label || spec?.aliases?.find(alias => /[\u3400-\u9fff]/.test(alias)) || field
    lines.push(`${label}：${text}`)
  }
  const outlineNodeId = typeof row.outlineNodeId === 'number'
    ? row.outlineNodeId
    : table === 'outlineNodes' && typeof row.id === 'number' ? row.id : undefined
  const simulationSessionId = typeof row.sessionId === 'number' ? row.sessionId : undefined
  const chapterCandidate = table === 'chapters'
    ? row.id
    : row.chapterId ?? row.sourceChapterId
      ?? (outlineNodeId != null ? scopeMetadata.chapterIdByOutlineNodeId.get(outlineNodeId) : undefined)
      ?? (simulationSessionId != null ? scopeMetadata.chapterIdBySimulationSessionId.get(simulationSessionId) : undefined)
  const sourceChapterId = typeof chapterCandidate === 'number' && Number.isFinite(chapterCandidate)
    ? chapterCandidate
    : 0
  const worldCandidate = row.worldGroupId ?? row.homeWorldGroupId
    ?? (outlineNodeId != null ? scopeMetadata.worldGroupIdByOutlineNodeId.get(outlineNodeId) : undefined)
    ?? (simulationSessionId != null ? scopeMetadata.worldGroupIdBySimulationSessionId.get(simulationSessionId) : undefined)
  const worldGroupId = typeof worldCandidate === 'number' && Number.isFinite(worldCandidate)
    ? worldCandidate
    : null
  return { title, text: lines.length > 1 ? lines.join('\n') : '', sourceChapterId, worldGroupId }
}

interface ProjectRagScopeMetadata {
  chapterIdByOutlineNodeId: ReadonlyMap<number, number>
  worldGroupIdByOutlineNodeId: ReadonlyMap<number, number | null>
  chapterIdBySimulationSessionId: ReadonlyMap<number, number>
  worldGroupIdBySimulationSessionId: ReadonlyMap<number, number | null>
}

async function loadProjectRagScopeMetadata(storage: ProjectStoragePort): Promise<ProjectRagScopeMetadata> {
  const [outlineNodes, chapters, simulationSessions] = await Promise.all([
    storage.table<OutlineNode>('outlineNodes').list(),
    storage.table<Chapter>('chapters').list(),
    storage.table<StorageRecord & Record<string, unknown>>('plotSimulationSessions').list(),
  ])
  const chapterIdByOutlineNodeId = new Map<number, number>()
  const worldGroupIdByOutlineNodeId = new Map<number, number | null>()
  const chapterIdBySimulationSessionId = new Map<number, number>()
  const worldGroupIdBySimulationSessionId = new Map<number, number | null>()
  for (const entry of resolveCanonicalChapterSequence(outlineNodes, chapters).sequence) {
    if (entry.chapter.id == null) continue
    chapterIdByOutlineNodeId.set(entry.chapter.outlineNodeId, entry.chapter.id)
    worldGroupIdByOutlineNodeId.set(entry.chapter.outlineNodeId, entry.worldGroupId)
  }
  for (const session of simulationSessions) {
    if (session.id == null) continue
    if (typeof session.chapterId === 'number') chapterIdBySimulationSessionId.set(session.id, session.chapterId)
    const worldGroupId = typeof session.worldGroupId === 'number' ? session.worldGroupId : null
    worldGroupIdBySimulationSessionId.set(session.id, worldGroupId)
  }
  return {
    chapterIdByOutlineNodeId,
    worldGroupIdByOutlineNodeId,
    chapterIdBySimulationSessionId,
    worldGroupIdBySimulationSessionId,
  }
}

function firstText(row: Record<string, unknown>, fields: readonly string[]): string {
  for (const field of fields) {
    const value = row[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function ragValueText(value: unknown, html = false, depth = 0): string {
  if (value == null || depth > 4) return ''
  if (typeof value === 'string') {
    const text = html ? htmlToPlainText(value) : value
    return text.trim()
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Blob || value instanceof ArrayBuffer) return ''
  if (Array.isArray(value)) return value.map(item => ragValueText(item, false, depth + 1)).filter(Boolean).join('；')
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const nested = ragValueText(item, false, depth + 1)
        return nested ? `${key}=${nested}` : ''
      })
      .filter(Boolean)
      .join('；')
  }
  return ''
}

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, '')
}

function extractSearchTerms(value: string): string[] {
  const terms = new Set<string>()
  const runs = value.toLocaleLowerCase().match(/[a-z0-9_\-]{2,}|[\u3400-\u9fff]{2,}/g) ?? []
  for (const run of runs) {
    terms.add(run)
    if (/^[\u3400-\u9fff]+$/.test(run)) {
      for (let size = 2; size <= Math.min(4, run.length); size++) {
        for (let index = 0; index + size <= run.length; index++) terms.add(run.slice(index, index + size))
      }
    }
    if (terms.size >= 80) break
  }
  return [...terms]
}

async function loadChapterOrder(
  projectId: number,
  storage?: ProjectStoragePort,
): Promise<Map<number, number>> {
  const activeStorage = storage ?? new DexieProjectStorage({ backend: 'dexie', projectId })
  const [outlineNodes, chapters] = await Promise.all([
    activeStorage.table<OutlineNode>('outlineNodes').list(),
    activeStorage.table<Chapter>('chapters').list(),
  ])
  const order = new Map<number, number>()
  resolveCanonicalChapterSequence(outlineNodes, chapters).sequence.forEach((entry, index) => {
    if (entry.chapter.id != null) order.set(entry.chapter.id, index)
  })
  return order
}

/**
 * 重建某章的检索块（删旧块 + 切块 + 抽关键词 + 写入）。正文未变（hash 相同）则跳过。
 * embedding 字段留空——由可选 embedding 通道异步回填，不阻塞。
 */
export async function rebuildChapterChunks(args: {
  projectId: number
  chapter: Chapter
  worldGroupId?: number | null
  knownEntities: string[]
}): Promise<{ rebuilt: boolean; count: number }> {
  const { projectId, chapter, worldGroupId, knownEntities } = args
  if (chapter.id == null) return { rebuilt: false, count: 0 }
  const normalized = normalizeChapterText(chapter.content || '')
  const hash = await hashChapterText(chapter.content || '')

  const existing = (await db.retrievalChunks.where('sourceChapterId').equals(chapter.id).toArray())
    .filter(chunk => (chunk.sourceTable ?? 'chapters') === 'chapters')
  if (existing.length
    && existing[0].sourceTextHash === hash
    && existing.every(chunk => (chunk.sourceTable ?? 'chapters') === 'chapters'
      && (chunk.sourceRecordId ?? chunk.sourceChapterId) === chapter.id)) {
    return { rebuilt: false, count: existing.length } // 正文未变，复用
  }
  // 正文变了 / 首次：清旧块重建
  if (existing.length) await db.retrievalChunks.bulkDelete(existing.map(c => c.id!).filter(Boolean))
  if (!normalized.trim()) return { rebuilt: true, count: 0 }

  const pieces = splitIntoChunks(normalized)
  const now = Date.now()
  const rows: RetrievalChunk[] = pieces.map((text, i) => ({
    projectId,
    worldGroupId: worldGroupId ?? null,
    sourceChapterId: chapter.id!,
    sourceTable: 'chapters',
    sourceRecordId: chapter.id!,
    sourceTitle: chapter.title || `章节 #${chapter.id}`,
    chunkIndex: i,
    text,
    keywords: extractKeywords(text, knownEntities),
    embedding: null,
    embeddingModel: null,
    sourceTextHash: hash,
    createdAt: now,
  }))
  if (rows.length) await db.retrievalChunks.bulkAdd(rows)
  return { rebuilt: true, count: rows.length }
}

/**
 * 为整个项目重建/补齐检索块。用于老书、导入项目和手动“建立索引”：
 * 先确保历史章节都有 retrievalChunks，embedding 再作为可选第二步补向量。
 */
export async function rebuildProjectRetrievalChunks(args: {
  projectId: number
  onProgress?: (done: number, total: number) => void
}): Promise<{
  chapters: number
  rebuiltChapters: number
  tables: number
  records: number
  rebuiltRecords: number
  chunks: number
}> {
  const [chapters, outlineNodes, characters, codexEntries, locations] = await Promise.all([
    db.chapters.where('projectId').equals(args.projectId).toArray(),
    db.outlineNodes.where('projectId').equals(args.projectId).toArray(),
    db.characters.where('projectId').equals(args.projectId).toArray(),
    db.codexEntries.where('projectId').equals(args.projectId).toArray(),
    db.importantLocations.where('projectId').equals(args.projectId).toArray(),
  ])
  const knownEntities = [
    ...characters.map(c => c.name),
    ...codexEntries.map(e => e.name),
    ...locations.map(l => l.name),
  ].filter((name): name is string => !!name && name.length >= 2)
  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const worldByChapter = new Map<number, number | null>()
  sequence.forEach(entry => {
    if (entry.chapter.id != null) worldByChapter.set(entry.chapter.id, entry.worldGroupId)
  })

  let rebuiltChapters = 0
  let chunks = 0
  const sorted = sequence.map(entry => entry.chapter)
  const sequenced = new Set(sorted.map(chapter => chapter.id))
  for (const chapter of chapters) {
    if (!sequenced.has(chapter.id)) sorted.push(chapter)
  }

  for (let i = 0; i < sorted.length; i++) {
    const chapter = sorted[i]
    const result = await rebuildChapterChunks({
      projectId: args.projectId,
      chapter,
      worldGroupId: chapter.id != null ? worldByChapter.get(chapter.id) ?? null : null,
      knownEntities,
    })
    if (result.rebuilt) rebuiltChapters++
    chunks += result.count
    args.onProgress?.(i + 1, sorted.length)
  }
  const projectData = await rebuildRegisteredProjectChunks(args.projectId)
  return {
    chapters: sorted.length,
    rebuiltChapters,
    tables: projectData.tables + 1,
    records: projectData.records + sorted.length,
    rebuiltRecords: projectData.rebuiltRecords + rebuiltChapters,
    chunks: chunks + projectData.chunks,
  }
}

async function rebuildRegisteredProjectChunks(projectId: number): Promise<{
  tables: number
  records: number
  rebuiltRecords: number
  chunks: number
}> {
  const sourceTables = projectRagSourceTables().filter(table => table !== 'chapters')
  const documents = await buildProjectRagDocuments({ projectId, sourceTables })
  const existing = (await db.retrievalChunks.where('projectId').equals(projectId).toArray())
    .filter(chunk => chunk.sourceTable != null && chunk.sourceTable !== 'chapters')
  const documentsByRecord = groupRagDocuments(documents)
  const existingByRecord = new Map<string, RetrievalChunk[]>()
  for (const chunk of existing) {
    if (chunk.sourceTable == null || chunk.sourceRecordId == null) continue
    const key = ragRecordKey(chunk.sourceTable, chunk.sourceRecordId)
    const list = existingByRecord.get(key) ?? []
    list.push(chunk)
    existingByRecord.set(key, list)
  }

  const deleteIds: number[] = []
  const additions: RetrievalChunk[] = []
  let rebuiltRecords = 0
  for (const [key, chunksForRecord] of existingByRecord) {
    const next = documentsByRecord.get(key)
    if (!next
      || chunksForRecord.length !== next.length
      || chunksForRecord.some(chunk => chunk.sourceTextHash !== next[0]?.sourceTextHash)) {
      deleteIds.push(...chunksForRecord.flatMap(chunk => chunk.id == null ? [] : [chunk.id]))
    }
  }
  for (const [key, next] of documentsByRecord) {
    const previous = existingByRecord.get(key)
    if (previous?.length
      && previous.length === next.length
      && previous.every(chunk => chunk.sourceTextHash === next[0].sourceTextHash)) continue
    rebuiltRecords++
    const now = Date.now()
    additions.push(...next.map(document => ({
      projectId,
      worldGroupId: document.worldGroupId,
      sourceChapterId: document.sourceChapterId,
      sourceTable: document.sourceTable,
      sourceRecordId: document.sourceRecordId,
      sourceTitle: document.sourceTitle,
      chunkIndex: document.chunkIndex,
      text: document.text,
      keywords: document.keywords,
      embedding: null,
      embeddingModel: null,
      sourceTextHash: document.sourceTextHash,
      createdAt: now,
    })))
  }
  if (deleteIds.length || additions.length) {
    await db.transaction('rw', db.retrievalChunks, async () => {
      if (deleteIds.length) await db.retrievalChunks.bulkDelete(deleteIds)
      if (additions.length) await db.retrievalChunks.bulkAdd(additions)
    })
  }
  return {
    tables: sourceTables.length,
    records: documentsByRecord.size,
    rebuiltRecords,
    chunks: documents.length,
  }
}

function groupRagDocuments(documents: readonly ProjectRagDocument[]): Map<string, ProjectRagDocument[]> {
  const grouped = new Map<string, ProjectRagDocument[]>()
  for (const document of documents) {
    const key = ragRecordKey(document.sourceTable, document.sourceRecordId)
    const list = grouped.get(key) ?? []
    list.push(document)
    grouped.set(key, list)
  }
  return grouped
}

function ragRecordKey(table: string, id: number): string {
  return `${table}:${id}`
}

function capText(text: string, max = SUMMARY_EXCERPT_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, max)}…`
}

function rollupLines(lines: string[], max = ROLLUP_CHARS): string {
  const out: string[] = []
  let used = 0
  for (const line of lines) {
    const clean = line.trim()
    if (!clean) continue
    if (used + clean.length > max) {
      const left = Math.max(0, max - used)
      if (left > 20) out.push(`${clean.slice(0, left)}…`)
      break
    }
    out.push(clean)
    used += clean.length
  }
  return out.join('\n')
}

function outlineById(nodes: OutlineNode[]): Map<number, OutlineNode> {
  return new Map(nodes.filter(node => node.id != null).map(node => [node.id!, node]))
}

function nearestVolume(node: OutlineNode | null, byId: Map<number, OutlineNode>): OutlineNode | null {
  let cur = node
  const guard = new Set<number>()
  while (cur?.id != null) {
    if (cur.type === 'volume') return cur
    if (cur.parentId == null || guard.has(cur.id)) return null
    guard.add(cur.id)
    cur = byId.get(cur.parentId) ?? null
  }
  return null
}

async function chapterSummaryText(chapter: Chapter, outlineNode: OutlineNode | null): Promise<{ summary: string; sourceHash: string; status: NarrativeSummaryNode['status'] }> {
  const sourceHash = await hashChapterText(chapter.content || '')
  const memory = await getChapterDerivedMemoryStatus(chapter)
  if (chapter.summary?.trim() && memory.summary === 'verified') {
    return { summary: chapter.summary.trim(), sourceHash, status: 'verified' }
  }
  const text = normalizeChapterText(chapter.content || '')
  if (text) {
    const outline = outlineNode?.summary?.trim()
    const fallback = outline ? `${outline}\n正文摘录：${capText(text)}` : `正文摘录：${capText(text)}`
    return { summary: fallback, sourceHash, status: 'verified' }
  }
  if (outlineNode?.summary?.trim()) {
    return { summary: outlineNode.summary.trim(), sourceHash, status: 'pending' }
  }
  return { summary: '', sourceHash, status: 'pending' }
}

/**
 * NS-5 · 重建章→卷→全书层级摘要树。
 *
 * v1 采用 deterministic roll-up：不额外烧 AI token；来源是当前正文、已验证章节摘要和大纲。
 * 这是派生记忆，不是 Canon；每次重建先把旧节点标为 rebuilding，再原子替换为新 verified/pending 节点。
 */
export async function rebuildProjectNarrativeSummaries(args: {
  projectId: number
  onProgress?: (done: number, total: number) => void
}): Promise<{ chapterNodes: number; volumeNodes: number; bookNodes: number; staleNodes: number }> {
  const [chapters, outlineNodes, characters, codexEntries, locations] = await Promise.all([
    db.chapters.where('projectId').equals(args.projectId).toArray(),
    db.outlineNodes.where('projectId').equals(args.projectId).toArray(),
    db.characters.where('projectId').equals(args.projectId).toArray(),
    db.codexEntries.where('projectId').equals(args.projectId).toArray(),
    db.importantLocations.where('projectId').equals(args.projectId).toArray(),
  ])
  const existing = await db.narrativeSummaryNodes.where('projectId').equals(args.projectId).toArray()
  for (const node of existing) {
    if (node.id != null) await db.narrativeSummaryNodes.update(node.id, { status: 'rebuilding', updatedAt: Date.now() })
  }

  const knownEntities = [
    ...characters.map(c => c.name),
    ...codexEntries.map(e => e.name),
    ...locations.map(l => l.name),
  ].filter((name): name is string => !!name && name.length >= 2)
  const byId = outlineById(outlineNodes)
  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const sequencedIds = new Set(sequence.map(entry => entry.chapter.id).filter((id): id is number => id != null))
  const ordered = [
    ...sequence,
    ...chapters
      .filter(chapter => chapter.id != null && !sequencedIds.has(chapter.id))
      .sort((a, b) => a.order - b.order || (a.id ?? 0) - (b.id ?? 0))
      .map(chapter => ({ chapter, outlineNode: null, worldGroupId: null })),
  ]

  const now = Date.now()
  const next: NarrativeSummaryNode[] = []
  const chapterNodesByVolume = new Map<number | 'root', NarrativeSummaryNode[]>()

  for (let i = 0; i < ordered.length; i++) {
    const entry = ordered[i]
    const chapter = entry.chapter
    if (chapter.id == null) continue
    const source = await chapterSummaryText(chapter, entry.outlineNode)
    const title = entry.outlineNode?.title || chapter.title || `章节#${chapter.id}`
    const summary = source.summary
    const volume = nearestVolume(entry.outlineNode, byId)
    const node: NarrativeSummaryNode = {
      projectId: args.projectId,
      worldGroupId: entry.worldGroupId ?? null,
      level: 'chapter',
      sourceChapterId: chapter.id,
      sourceOutlineNodeId: entry.outlineNode?.id ?? null,
      title,
      summary,
      keywords: extractKeywords(`${title}\n${summary}`, knownEntities),
      sourceHash: source.sourceHash,
      status: source.status,
      generatedBy: 'system-rollup',
      createdAt: now,
      updatedAt: now,
    }
    next.push(node)
    const volumeKey = volume?.id ?? 'root'
    const list = chapterNodesByVolume.get(volumeKey) ?? []
    list.push(node)
    chapterNodesByVolume.set(volumeKey, list)
    args.onProgress?.(i + 1, ordered.length)
  }

  const volumeNodes: NarrativeSummaryNode[] = []
  for (const [volumeKey, children] of chapterNodesByVolume) {
    if (!children.length) continue
    const volume = typeof volumeKey === 'number' ? byId.get(volumeKey) ?? null : null
    const title = volume?.title ?? '未分卷章节'
    const sourceText = children.map(child => `${child.sourceChapterId}:${child.sourceHash}:${child.status}:${child.summary}`).join('\n')
    const summary = rollupLines(children.map(child => `- ${child.title}：${child.summary}`))
    const status = children.some(child => child.status === 'verified') ? 'verified' : 'pending'
    const node: NarrativeSummaryNode = {
      projectId: args.projectId,
      worldGroupId: children.find(child => child.worldGroupId != null)?.worldGroupId ?? volume?.worldGroupId ?? null,
      level: 'volume',
      sourceChapterId: null,
      sourceOutlineNodeId: volume?.id ?? null,
      title,
      summary,
      keywords: extractKeywords(`${title}\n${summary}`, knownEntities),
      sourceHash: await sha256Text(sourceText),
      status,
      generatedBy: 'system-rollup',
      createdAt: now,
      updatedAt: now,
    }
    volumeNodes.push(node)
    next.push(node)
  }

  const bookSummary = rollupLines(volumeNodes.length
    ? volumeNodes.map(node => `- ${node.title}：${node.summary}`)
    : next.filter(node => node.level === 'chapter').map(node => `- ${node.title}：${node.summary}`), 1800)
  const bookSource = next.map(node => `${node.level}:${node.sourceOutlineNodeId ?? ''}:${node.sourceChapterId ?? ''}:${node.sourceHash}:${node.status}`).join('\n')
  if (bookSummary) {
    next.push({
      projectId: args.projectId,
      worldGroupId: null,
      level: 'book',
      sourceChapterId: null,
      sourceOutlineNodeId: null,
      title: '全书叙事摘要',
      summary: bookSummary,
      keywords: extractKeywords(bookSummary, knownEntities),
      sourceHash: await sha256Text(bookSource),
      status: next.some(node => node.status === 'verified') ? 'verified' : 'pending',
      generatedBy: 'system-rollup',
      createdAt: now,
      updatedAt: now,
    })
  }

  await db.transaction('rw', db.narrativeSummaryNodes, async () => {
    const keys = (await db.narrativeSummaryNodes.where('projectId').equals(args.projectId).primaryKeys()) as number[]
    if (keys.length) await db.narrativeSummaryNodes.bulkDelete(keys)
    if (next.length) await db.narrativeSummaryNodes.bulkAdd(next)
  })
  return {
    chapterNodes: next.filter(node => node.level === 'chapter').length,
    volumeNodes: next.filter(node => node.level === 'volume').length,
    bookNodes: next.filter(node => node.level === 'book').length,
    staleNodes: existing.filter(node => node.status === 'stale' || node.status === 'rebuilding').length,
  }
}

/**
 * 按当前章读取已验证的层级摘要：全书 + 所属卷 + 当前章之前的少量章节节点。
 * 未验证/重建中/过期节点不注入，避免派生记忆污染生成。
 */
export async function readNarrativeSummaryContext(args: {
  projectId: number
  currentChapterId: number
  worldGroupId?: number | null
  maxChapterNodes?: number
}): Promise<string> {
  const [nodes, outlineNodes, chapters] = await Promise.all([
    db.narrativeSummaryNodes.where('projectId').equals(args.projectId).filter(node => node.status === 'verified').toArray(),
    db.outlineNodes.where('projectId').equals(args.projectId).toArray(),
    db.chapters.where('projectId').equals(args.projectId).toArray(),
  ])
  if (!nodes.length) return ''
  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const orderOf = new Map<number, number>()
  const outlineOf = new Map<number, OutlineNode | null>()
  const chapterById = new Map(chapters.filter(chapter => chapter.id != null).map(chapter => [chapter.id!, chapter]))
  sequence.forEach((entry, i) => {
    if (entry.chapter.id != null) {
      orderOf.set(entry.chapter.id, i)
      outlineOf.set(entry.chapter.id, entry.outlineNode)
    }
  })
  const currentOrder = orderOf.get(args.currentChapterId)
  if (currentOrder == null) return ''
  const byId = outlineById(outlineNodes)
  const currentVolume = nearestVolume(outlineOf.get(args.currentChapterId) ?? null, byId)
  const staleSourceIds = new Set<number>()
  for (const node of nodes) {
    if (node.level !== 'chapter' || node.sourceChapterId == null) continue
    const chapter = chapterById.get(node.sourceChapterId)
    if (!chapter || await hashChapterText(chapter.content || '') !== node.sourceHash) {
      staleSourceIds.add(node.sourceChapterId)
    }
  }
  const lines: string[] = ['【层级叙事摘要（章→卷→全书，派生记忆；只含已验证节点）】']
  const priorChapterNodes = nodes
    .filter(node => {
      if (node.level !== 'chapter' || node.sourceChapterId == null) return false
      if (staleSourceIds.has(node.sourceChapterId)) return false
      const order = orderOf.get(node.sourceChapterId)
      if (order == null || order >= currentOrder) return false
      if (node.worldGroupId != null && node.worldGroupId !== (args.worldGroupId ?? null)) return false
      return true
    })
    .sort((a, b) => (orderOf.get(a.sourceChapterId!) ?? -1) - (orderOf.get(b.sourceChapterId!) ?? -1))

  if (priorChapterNodes.length) {
    lines.push(`【全书截至本章】\n${rollupLines(priorChapterNodes.map(node => `- ${node.title}：${node.summary}`), 1800)}`)
  }

  const volumeNodes = currentVolume
    ? priorChapterNodes.filter(node => {
        const outline = node.sourceOutlineNodeId != null ? byId.get(node.sourceOutlineNodeId) ?? null : null
        return nearestVolume(outline, byId)?.id === currentVolume.id
      })
    : []
  if (currentVolume && volumeNodes.length) {
    lines.push(`【本卷截至本章：${currentVolume.title}】\n${rollupLines(volumeNodes.map(node => `- ${node.title}：${node.summary}`), 1200)}`)
  }

  const recent = priorChapterNodes.slice(-(args.maxChapterNodes ?? 8))
  if (recent.length) {
    lines.push('【当前章之前的摘要节点】')
    for (const node of recent) lines.push(`- ${node.title}：${node.summary}`)
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

export interface RetrievedChunk {
  chunk: RetrievalChunk
  score: number
}

/**
 * 召回与查询相关的历史块。
 * - queryTerms：当前章的实体/关键词（角色名、章纲要点）；
 * - queryEmbedding：可选，提供则叠加余弦分（混合检索）；
 * - 硬过滤：只取规范章序 < 当前章的块（不泄漏未来）、当前世界（∪ null）。
 */
export async function retrieveChunks(args: {
  projectId: number
  currentChapterId: number
  worldGroupId?: number | null
  queryTerms: string[]
  queryEmbedding?: number[] | null
  /** 查询向量所属模型；只对同模型的块向量算余弦，绝不跨模型混算（不传则不限制） */
  queryEmbeddingModel?: string | null
  topK?: number
}): Promise<RetrievedChunk[]> {
  const { projectId, currentChapterId, worldGroupId, queryTerms, queryEmbedding, queryEmbeddingModel, topK = 6 } = args
  const [chunks, outlineNodes, chapters] = await Promise.all([
    db.retrievalChunks.where('projectId').equals(projectId).toArray(),
    db.outlineNodes.where('projectId').equals(projectId).toArray(),
    db.chapters.where('projectId').equals(projectId).toArray(),
  ])
  if (!chunks.length) return []

  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const orderOf = new Map<number, number>()
  sequence.forEach((entry, i) => { if (entry.chapter.id != null) orderOf.set(entry.chapter.id, i) })
  const currentOrder = orderOf.get(currentChapterId)
  if (currentOrder == null) return []

  const terms = queryTerms.filter(t => t && t.length >= 2)
  const scored: RetrievedChunk[] = []
  for (const chunk of chunks) {
    const chunkOrder = orderOf.get(chunk.sourceChapterId)
    if (chunkOrder == null || chunkOrder >= currentOrder) continue          // 未来/当前章不召回
    if (chunk.worldGroupId != null && chunk.worldGroupId !== (worldGroupId ?? null)) continue // 世界隔离
    // 关键词重叠分（命中实体 + 命中文本词）
    let kw = 0
    for (const t of terms) {
      if (chunk.keywords.includes(t)) kw += 2
      else if (chunk.text.includes(t)) kw += 1
    }
    // 可选 embedding 余弦：仅当查询向量与块向量出自同一模型时才算（防跨模型混算）
    const sameModel = !queryEmbeddingModel || chunk.embeddingModel === queryEmbeddingModel
    const sem = queryEmbedding && sameModel ? cosineSimilarity(queryEmbedding, chunk.embedding) : 0
    const score = kw + sem * 3
    if (score > 0) scored.push({ chunk, score })
  }
  scored.sort((a, b) => b.score - a.score || b.chunk.sourceChapterId - a.chunk.sourceChapterId)
  // 取 top-K 后按时间(章序→块序)重组，便于阅读
  const top = scored.slice(0, topK)
  top.sort((a, b) =>
    (orderOf.get(a.chunk.sourceChapterId)! - orderOf.get(b.chunk.sourceChapterId)!) ||
    (a.chunk.chunkIndex - b.chunk.chunkIndex))
  return top
}

// ── Embedding 通道（NS-5 语义检索，可选；不可用时上面纯关键词照常工作） ──

const EMBED_BATCH = 16

/**
 * 把查询文本嵌成向量供 retrieveChunks 混合打分用；不可用/失败返回 null（调用方退回纯关键词）。
 */
export async function embedQuery(text: string, cfg: EmbeddingConfig | null | undefined, projectId?: number | null): Promise<number[] | null> {
  if (!isEmbeddingReady(cfg) || !text.trim()) return null
  try {
    const [vec] = await embedTexts([text], cfg, projectId)
    return vec || null
  } catch (err) {
    console.warn('[NS-5] 查询嵌入失败，退回关键词通道:', err)
    return null
  }
}

/**
 * 为项目内"缺向量或向量过期(换了模型)"的检索块批量回填 embedding。
 * 幂等可续跑：每批落盘，再次运行只补未完成的；与当前模型不符的向量视为过期、重算。
 * 任一批失败不丢已完成的，整体抛错由调用方提示。
 */
export async function ensureChunkEmbeddings(args: {
  projectId: number
  cfg: EmbeddingConfig
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}): Promise<{ embedded: number; total: number; skipped: number }> {
  const { projectId, cfg, onProgress, signal } = args
  if (!isEmbeddingReady(cfg)) return { embedded: 0, total: 0, skipped: 0 }
  const tag = embeddingModelTag(cfg)
  const all = await db.retrievalChunks.where('projectId').equals(projectId).toArray()
  const pending = all.filter(c => c.id != null && (!c.embedding || !c.embedding.length || c.embeddingModel !== tag))
  const total = pending.length
  let embedded = 0
  for (let i = 0; i < pending.length; i += EMBED_BATCH) {
    if (signal?.aborted) break
    const batch = pending.slice(i, i + EMBED_BATCH)
    const vectors = await embedTexts(batch.map(c => c.text), cfg, projectId, signal)
    await db.transaction('rw', db.retrievalChunks, async () => {
      for (let j = 0; j < batch.length; j++) {
        await db.retrievalChunks.update(batch[j].id!, { embedding: vectors[j], embeddingModel: tag })
      }
    })
    embedded += batch.length
    onProgress?.(embedded, total)
  }
  return { embedded, total, skipped: all.length - total }
}
