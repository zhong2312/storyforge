/**
 * NS-4 · 事实账本写回（单一入口，禁止组件/面板裸写 db.temporalFacts）。
 *
 * 设计权威 §14.4 / §14.6：
 * - 抽取产出一律落 status:'candidate'（Evidence Observation）；
 * - 谓词受 FACT_PREDICATE_REGISTRY 控制；
 * - 主体名 → 分类型 FK（characterId）在此解析（有主表才建 FK，否则只留 subjectName）；
 * - 去重：同主体+谓词+值的【未关闭候选】不重复写；
 * - ★不在此自动 supersede 旧权威事实——supersede 只发生在【作者确认候选/异常复核】时（confirmFactCandidate），
 *   候选(observation)不改 canon（§14.6「无证据 observation 不得自动升级为 Canon」）。
 */
import { db } from '../db/schema'
import type { TemporalFact } from '../types/temporal-fact'
import type { ExtractedFactCandidate } from '../ai/adapters/fact-extract-adapter'
import { getFactPredicate } from '../registry/fact-predicate-registry'

const now = () => Date.now()

/** 按名字解析角色 FK（同项目精确匹配）。无主表实体返回 null，仅留 subjectName。 */
async function resolveCharacterId(projectId: number, name: string): Promise<number | null> {
  if (!name) return null
  const hit = await db.characters.where('projectId').equals(projectId).filter(c => c.name === name).first()
  return hit?.id ?? null
}

export interface AdoptFactsResult {
  written: number
  skippedDuplicate: number
  skippedUnknownPredicate: number
}

/**
 * 把抽取候选写入事实账本（单一注册入口）。
 * @param worldGroupId 当前章节所属世界组（多世界隔离），null = 默认主世界
 */
export async function adoptFactCandidates(args: {
  projectId: number
  sourceChapterId: number
  worldGroupId?: number | null
  candidates: ExtractedFactCandidate[]
}): Promise<AdoptFactsResult> {
  const result: AdoptFactsResult = { written: 0, skippedDuplicate: 0, skippedUnknownPredicate: 0 }

  // 本项目当前所有未关闭候选，用于去重（一次性取，避免逐条查库）
  const existing = await db.temporalFacts
    .where('projectId').equals(args.projectId)
    .filter(f => f.validToChapterId == null && f.status === 'candidate')
    .toArray()
  const seen = new Set(existing.map(f => `${f.subjectName}|${f.predicate}|${f.value}`))

  for (const c of args.candidates) {
    const spec = getFactPredicate(c.predicate)
    if (!spec) { result.skippedUnknownPredicate++; continue }   // 受控谓词守卫（双保险）

    const key = `${c.subjectName}|${c.predicate}|${c.value}`
    if (seen.has(key)) { result.skippedDuplicate++; continue }
    seen.add(key)

    const characterId = await resolveCharacterId(args.projectId, c.subjectName)
    const objectCharacterId = c.objectName ? await resolveCharacterId(args.projectId, c.objectName) : null

    const fact: TemporalFact = {
      projectId: args.projectId,
      worldGroupId: args.worldGroupId ?? null,
      characterId,
      subjectName: c.subjectName,
      objectCharacterId: spec.objectEntityTypes?.includes('character') ? objectCharacterId : null,
      predicate: c.predicate,
      factKind: c.factKind,
      value: c.value,
      sourceType: 'chapter',
      sourceChapterId: args.sourceChapterId,
      sourceQuote: c.sourceQuote,
      validFromChapterId: args.sourceChapterId,
      validToChapterId: null,
      status: 'candidate',
      locked: false,
      createdAt: now(),
      updatedAt: now(),
    }
    await db.temporalFacts.add(fact)
    result.written++
  }
  return result
}

/**
 * 作者确认候选/异常事实 → 升为 Canon（confirmed）。§14.4：state 单值谓词在此【关闭被它取代的旧有效事实】，
 * 不按字符串相似度自动覆盖、不动 locked、event 不可被 supersede。
 */
export async function confirmFactCandidate(factId: number): Promise<void> {
  const fact = await db.temporalFacts.get(factId)
  if (!fact || fact.id == null) return
  if (!['candidate', 'stale', 'source-missing', 'invalid-range'].includes(fact.status)) return
  const spec = getFactPredicate(fact.predicate)

  // 单值 state 谓词：关闭同主体+谓词、当前仍有效、非锁定的旧事实（明确取代）。
  if (spec && spec.factKind === 'state' && spec.cardinality === 'single' && spec.conflictPolicy === 'supersede') {
    const priors = await db.temporalFacts
      .where('projectId').equals(fact.projectId)
      .filter(f =>
        f.id !== fact.id &&
        f.predicate === fact.predicate &&
        f.subjectName === fact.subjectName &&
        f.validToChapterId == null &&
        f.status === 'confirmed' &&
        !f.locked,
      )
      .toArray()
    for (const p of priors) {
      if (p.id != null) {
        await db.temporalFacts.update(p.id, {
          validToChapterId: fact.validFromChapterId ?? null,
          status: 'superseded',
          updatedAt: now(),
        })
      }
    }
  }
  await db.temporalFacts.update(fact.id, { status: 'confirmed', supersedesFactId: fact.supersedesFactId ?? null, updatedAt: now() })
}

/** 作者否决候选/异常事实（不入 Canon、不再注入生成）。不动已确认/已锁定事实。 */
export async function rejectFactCandidate(factId: number): Promise<void> {
  const fact = await db.temporalFacts.get(factId)
  if (!fact || fact.id == null || fact.status === 'confirmed' || fact.locked) return
  await db.temporalFacts.update(fact.id, { status: 'rejected', updatedAt: now() })
}

/** 读某项目的事实（按状态可选过滤），供事实库 UI 与投影使用。 */
export async function listFacts(projectId: number, status?: TemporalFact['status']): Promise<TemporalFact[]> {
  const rows = await db.temporalFacts.where('projectId').equals(projectId).toArray()
  return status ? rows.filter(f => f.status === status) : rows
}
