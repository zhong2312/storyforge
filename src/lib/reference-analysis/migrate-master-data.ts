/**
 * 数据迁移：masterWorks + masterChunkAnalysis → references + referenceChunkAnalysis
 *
 * 旧 5 维 → 新 8 维映射：
 *   worldviewPattern  → worldBuilding
 *   characterDesign   → characterCraft
 *   plotRhythm        → plotRhythm
 *   foreshadowing     → foreshadowing
 *   proseStyle        → proseAndDialogue
 *   (新增维度 narrativeStructure / openingTechnique / conflictEscalation 无旧数据，留空)
 *
 * 迁移策略：
 *   · 为每个 MasterWork 创建一条 Reference（type='story'）
 *   · 将 masterChunkAnalysis 转写为 referenceChunkAnalysis
 *   · 迁移完成后在 localStorage 标记，不重复执行
 */
import { db } from '../db/schema'
import type { Reference, ReferenceChunkAnalysis } from '../types'

const MIGRATION_KEY = 'sf-master-to-ref-migrated'

/** 检查是否已迁移 */
export function isMasterDataMigrated(): boolean {
  return localStorage.getItem(MIGRATION_KEY) === '1'
}

/** 执行迁移（幂等，已迁移则跳过） */
export async function migrateMasterDataToReferences(): Promise<{
  migrated: number
  skipped: number
}> {
  if (isMasterDataMigrated()) return { migrated: 0, skipped: 0 }

  const works = await db.masterWorks.toArray()
  if (works.length === 0) {
    localStorage.setItem(MIGRATION_KEY, '1')
    return { migrated: 0, skipped: 0 }
  }

  let migrated = 0
  let skipped = 0

  for (const work of works) {
    // 检查是否已有同名 reference（避免重复迁移）
    const existing = await db.references
      .where('projectId').equals(work.projectId || 0)
      .filter(r => r.title === work.title && r.fileHash === work.fileHash)
      .first()

    if (existing) {
      skipped++
      continue
    }

    // 创建 Reference
    const now = Date.now()
    const ref: Reference = {
      projectId: work.projectId || 0,
      title: work.title,
      author: work.author || '',
      type: 'story',
      note: `从「作品学习」迁移（原 ID: ${work.id}）`,
      url: '',
      genre: work.genre,
      totalChars: work.totalChars,
      fileHash: work.fileHash,
      importSessionId: work.importSessionId,
      analysisDepth: work.analysisDepth === 'deep' ? 'deep' : 'quick',  // 旧 standard → 浅层
      analysisStatus: work.status === 'done' ? 'done' : work.status === 'failed' ? 'failed' : 'none',
      analysisProgress: work.progress,
      analysisError: work.errorMessage,
      createdAt: work.createdAt,
      updatedAt: now,
    }

    const refId = await db.references.add(ref) as number

    // 迁移分块分析（旧 5 维 → 新 13 维,仅映射能对上的几维,其余留空待用户重跑）
    const chunks = await db.masterChunkAnalysis
      .where('workId').equals(work.id!)
      .sortBy('chunkIndex')

    for (const chunk of chunks) {
      const newChunk: ReferenceChunkAnalysis = {
        referenceId: refId,
        chunkIndex: chunk.chunkIndex,
        label: chunk.label,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        // 旧 5 维 → 新 13 维（仅对得上的)
        plotStructure: chunk.plotRhythm,
        characterCraft: chunk.characterDesign,
        foreshadowing: chunk.foreshadowing,
        proseStyle: chunk.proseStyle,
        worldBuilding: chunk.worldviewPattern,
        rawExcerpt: chunk.rawExcerpt,
        createdAt: chunk.createdAt,
      }
      await db.referenceChunkAnalysis.add(newChunk)
    }

    migrated++
  }

  localStorage.setItem(MIGRATION_KEY, '1')
  console.log(`[migrate] Master → Reference: migrated ${migrated}, skipped ${skipped}`)
  return { migrated, skipped }
}
