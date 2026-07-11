/**
 * assembleContext(Phase 1.3a) · 统一上下文装配入口。
 *
 * 1.3a 只新增入口。1.3b 再把 ai.start/chat 调用迁移到这里。
 */
import { estimateTokens, getModelPreset, type ContextLayer, type ContextSegment } from '../ai/context-budget'
import { CONTEXT_SOURCES, CONTEXT_SOURCE_BY_KEY } from './context-sources'
import type { AssembleContextInput, AssembleContextResult, ContextSource } from './types'
import { prepareContinuityContext } from '../ai/chapter-memory/continuity-context'
import type { PreparedContinuityContext } from '../ai/chapter-memory/continuity-context'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import type { Chapter, OutlineNode } from '../types'
import { htmlToPlainText } from '../utils/html'

/** 拿不到模型时的保守默认输入预算(原固定 24K 偏紧,放宽避免内部提前裁) */
const FALLBACK_INPUT_BUDGET = 48_000
const LAYERS_BY_TRIM_PRIORITY: ContextLayer[] = ['L3', 'L2', 'L1']

/**
 * 输入预算 = 所选模型的上下文窗口(减输出预留与安全边际)。
 * 这样上下文只在「真的接近模型窗口」时才按优先级软裁,而不是被固定小预算提前砍。
 */
function deriveInputBudget(input: AssembleContextInput): number {
  if (input.inputBudgetTokens && input.inputBudgetTokens > 0) return input.inputBudgetTokens
  if (input.provider && input.model) {
    const preset = getModelPreset(input.provider, input.model)
    const budget = preset.maxContext - preset.maxOutput - Math.round(preset.maxContext * 0.05)
    if (budget > 0) return budget
  }
  return FALLBACK_INPUT_BUDGET
}

export async function assembleContext(input: AssembleContextInput): Promise<AssembleContextResult> {
  const selected = selectSources(input)
  const needsContinuity = selected.some(source => (
    source.key === 'previousChapterEnding'
    || source.key === 'chapterContinuityHandoff'
    || source.key === 'previousPlanReconciliation'
    || source.key === 'recentChapterSummaries'
  ))
  const resolvedInput: AssembleContextInput = needsContinuity && input.chapterId != null
    ? {
        ...input,
        continuitySnapshot: input.continuitySnapshot ?? (input.storage
          ? await prepareStorageContinuityContext(input.storage, input.projectId, input.chapterId)
          : await prepareContinuityContext({
              projectId: input.projectId,
              chapterId: input.chapterId,
            })),
      }
    : input
  const omitted: string[] = []
  const keyedSegments: { key: string; segment: ContextSegment }[] = []

  for (const source of selected) {
    if (!requirementsMet(source, resolvedInput)) {
      omitted.push(source.key)
      continue
    }
    if (source.enabled && !await source.enabled(resolvedInput)) {
      omitted.push(source.key)
      continue
    }
    const content = await source.read(resolvedInput)
    if (!content.trim()) {
      omitted.push(source.key)
      continue
    }
    const capped = capBySourceBudget(content, source.budgetTokens)
    keyedSegments.push({
      key: source.key,
      segment: {
        label: source.label,
        layer: source.layer,
        content: capped,
        tokens: estimateTokens(capped),
        trimmable: source.layer !== 'L0' && !source.protectedFromTrim,
      },
    })
  }

  const totalBeforeTrim = keyedSegments.reduce((sum, s) => sum + s.segment.tokens, 0)
  const inputBudget = deriveInputBudget(input)
  const overBudgetBeforeTrim = totalBeforeTrim > inputBudget
  const { kept, trimmed } = trimToFit(keyedSegments, inputBudget)
  const segments = kept.map(s => s.segment)
  const totalInputTokens = segments.reduce((sum, s) => sum + s.tokens, 0)

  return {
    text: segments.map(s => s.content).join('\n\n'),
    segments,
    included: kept.map(s => s.key),
    omitted,
    trimmed,
    totalInputTokens,
    inputBudget,
    overBudgetBeforeTrim,
    overBudgetAfterTrim: totalInputTokens > inputBudget,
  }
}

async function prepareStorageContinuityContext(
  storage: NonNullable<AssembleContextInput['storage']>,
  projectId: number,
  chapterId: number,
): Promise<PreparedContinuityContext> {
  const [outlineNodes, chapters] = await Promise.all([
    storage.table<OutlineNode>('outlineNodes').list({ where: { projectId } }),
    storage.table<Chapter>('chapters').list({ where: { projectId } }),
  ])
  const resolved = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const currentIndex = resolved.sequence.findIndex(entry => entry.chapter.id === chapterId)
  const current = currentIndex >= 0 ? resolved.sequence[currentIndex] : null
  const predecessor = currentIndex > 0 ? resolved.sequence[currentIndex - 1] : null
  const previousTail = predecessor?.chapter.content
    ? htmlToPlainText(predecessor.chapter.content).slice(-1200)
    : ''
  const handoff = predecessor?.chapter.continuityHandoff
  const reconciliation = predecessor?.chapter.planReconciliation
  const recent = current
    ? resolved.sequence.slice(0, currentIndex)
      .filter(entry => entry.worldGroupId === current.worldGroupId && entry.chapter.summary)
      .slice(-5)
      .map(entry => `- ${entry.outlineNode?.title ?? entry.chapter.title}：${entry.chapter.summary}`)
    : []
  return {
    current,
    predecessor,
    previousTailText: previousTail ? `【全局叙事直接前驱原文尾部】\n${previousTail}` : '',
    handoffText: handoff ? `【全局叙事直接前驱交接】\n${JSON.stringify(handoff, null, 2)}` : '',
    planReconciliationText: reconciliation ? `【前章计划—正文对账】\n${JSON.stringify(reconciliation, null, 2)}` : '',
    recentSummariesText: recent.length ? `【当前世界最近章节摘要 · 旧→新】\n${recent.join('\n')}` : '',
    memoryRebuildCandidateIds: [],
    anomalies: resolved.anomalies,
  }
}

function selectSources(input: AssembleContextInput): ContextSource[] {
  if (!input.sourceKeys?.length) return CONTEXT_SOURCES
  return input.sourceKeys
    .map(key => CONTEXT_SOURCE_BY_KEY.get(key))
    .filter((source): source is ContextSource => !!source)
}

function requirementsMet(source: ContextSource, input: AssembleContextInput): boolean {
  if (source.requiresWorldGroupId && !Object.prototype.hasOwnProperty.call(input, 'worldGroupId')) return false
  if (source.requiresOutlineNodeId && input.outlineNodeId == null && input.chapterId == null) return false
  if (source.requiresChapterId && input.chapterId == null) return false
  return true
}

function capBySourceBudget(content: string, budgetTokens: number): string {
  if (!budgetTokens || estimateTokens(content) <= budgetTokens) return content
  const approxChars = Math.max(100, Math.floor(budgetTokens * 1.4))
  return `${content.slice(0, approxChars)}\n…（该上下文源已按预算截断）`
}

function trimToFit(
  segments: { key: string; segment: ContextSegment }[],
  inputBudget: number,
): { kept: { key: string; segment: ContextSegment }[]; trimmed: string[] } {
  let kept = [...segments]
  const trimmed: string[] = []
  let total = kept.reduce((sum, s) => sum + s.segment.tokens, 0)
  if (total <= inputBudget) return { kept, trimmed }

  for (const layer of LAYERS_BY_TRIM_PRIORITY) {
    if (total <= inputBudget) break
    const removed = kept.filter(s => s.segment.layer === layer && s.segment.trimmable)
    if (!removed.length) continue
    kept = kept.filter(s => s.segment.layer !== layer || !s.segment.trimmable)
    total = kept.reduce((sum, s) => sum + s.segment.tokens, 0)
    trimmed.push(...removed.map(s => s.key))
  }

  return { kept, trimmed }
}
