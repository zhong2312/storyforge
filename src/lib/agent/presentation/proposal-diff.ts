import { diffLines, diffWordsWithSpace, type Change } from 'diff'
import { FIELD_BY_TARGET } from '../../registry/field-registry'
import { htmlToPlainText } from '../../utils/html'
import type { AgentChangePreview } from '../events/agent-events'
import { proposalPreviewMarkdown } from './proposal-markdown'

export interface ProposalDiff {
  readonly beforeText: string
  readonly afterText: string
  readonly changes: readonly Change[]
  readonly changed: boolean
}

export function createProposalDiff(preview: AgentChangePreview): ProposalDiff {
  const beforeData = normalizeData(preview.beforeData)
  const proposedData = normalizeData(preview.data)
  const afterData = mergeAfterData(preview, beforeData, proposedData)

  const beforeText = comparableText(preview, beforeData, '（无现有内容）')
  const afterText = comparableText(preview, afterData, '（无候选内容）')
  const diff = Math.max(beforeText.length, afterText.length) > 30_000
    ? diffLines(beforeText, afterText)
    : diffWordsWithSpace(beforeText, afterText)
  return {
    beforeText,
    afterText,
    changes: diff,
    changed: diff.some(change => change.added || change.removed),
  }
}

function normalizeData(
  data: AgentChangePreview['data'] | AgentChangePreview['beforeData'],
): readonly Readonly<Record<string, unknown>>[] {
  if (!data) return []
  return Array.isArray(data) ? data : [data as Readonly<Record<string, unknown>>]
}

function mergeAfterData(
  preview: AgentChangePreview,
  before: readonly Readonly<Record<string, unknown>>[],
  proposed: readonly Readonly<Record<string, unknown>>[],
): readonly Readonly<Record<string, unknown>>[] {
  if (before.length === 0 || preview.mode === 'add' || preview.mode === 'add-many') return proposed
  return proposed.map((item, index) => {
    const base = before[index] ?? before[0] ?? {}
    const normalized = normalizeFields(preview.target, item)
    if (preview.mode !== 'append') return { ...base, ...normalized }

    const appended = { ...base }
    const fieldSpecs = FIELD_BY_TARGET.get(preview.target) ?? []
    for (const [field, value] of Object.entries(normalized)) {
      const spec = fieldSpecs.find(candidate => candidate.field === field)
      const current = appended[field]
      appended[field] = spec?.type === 'longtext' && current && value
        ? `${String(current)}\n\n${String(value)}`
        : value
    }
    return appended
  })
}

function normalizeFields(target: string, item: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  const fields = FIELD_BY_TARGET.get(target) ?? []
  const canonicalByInput = new Map<string, string>()
  for (const field of fields) {
    canonicalByInput.set(field.field, field.field)
    for (const alias of field.aliases ?? []) canonicalByInput.set(alias, field.field)
  }
  for (const [field, value] of Object.entries(item)) {
    const canonical = canonicalByInput.get(field)
    if (canonical) normalized[canonical] = value
  }
  return normalized
}

function comparableText(
  preview: AgentChangePreview,
  data: readonly Readonly<Record<string, unknown>>[],
  emptyText: string,
): string {
  if (data.length === 0) return emptyText
  if (preview.target === 'chapters') {
    const chapters = data.flatMap((item, index) => {
      const content = item.content
      if (typeof content !== 'string') return []
      const text = htmlToPlainText(content)
      if (data.length === 1) return [text]
      const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `第 ${index + 1} 项`
      return [`【${title}】\n${text}`]
    })
    return chapters.length ? chapters.join('\n\n') : emptyText
  }
  return proposalPreviewMarkdown({ ...preview, data }) || emptyText
}
