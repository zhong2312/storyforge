import type { ChatMessage } from '../../types'

export type ConsistencyAuditMode = 'fast' | 'deep'
export type ConsistencySeverity = 'hard' | 'risk' | 'unknown'

export interface ConsistencyFinding {
  category: string
  severity: ConsistencySeverity
  quote: string
  evidence: Array<{
    sourceType: 'canon' | 'observation' | 'chapter' | 'summary'
    sourceId: number
    quote: string
  }>
  reason: string
  suggestion?: string
}

export interface ConsistencyAuditResult {
  mode: ConsistencyAuditMode
  findings: ConsistencyFinding[]
}

export function buildConsistencyAuditPrompt(args: {
  mode: ConsistencyAuditMode
  chapterTitle: string
  chapterContent: string
  evidenceContext: string
}): ChatMessage[] {
  const focus = args.mode === 'fast'
    ? '只检查地点/世界归属、存亡、持有物数量、力量阶段、明确知识变化、绝对时间先后和直接规则冲突。目标是低误报；证据不足就不要报 hard。'
    : '检查因果链、角色动机与长期弧光、伏笔遗漏或错误回收、故事线推进、复杂时间关系、社会规范、世界规则和叙事软风险。'
  return [
    {
      role: 'system',
      content: `你是小说一致性证据审计器。${focus}

输出严格 JSON：
{"findings":[{"category":"分类","severity":"hard|risk|unknown","quote":"待审正文逐字引文","evidence":[{"sourceType":"chapter|summary|observation|canon","sourceId":0,"quote":"证据上下文逐字引文"}],"reason":"为何冲突或有风险","suggestion":"可选建议"}]}

规则：
1. quote 必须逐字来自待审正文；
2. evidence.quote 必须逐字来自证据上下文；
3. hard 必须有至少一条正确证据，且只能用于直接矛盾；
4. 创作选择、信息不足或可能解释得通的内容只能标 risk/unknown；
5. 不输出总分，不自动修改正文；没有问题返回空 findings。`,
    },
    {
      role: 'user',
      content: `【章节】${args.chapterTitle}\n\n【待审正文】\n${args.chapterContent}\n\n【只读证据上下文】\n${args.evidenceContext}\n\n请输出 JSON：`,
    },
  ]
}

export function parseConsistencyAuditResult(args: {
  raw: string
  mode: ConsistencyAuditMode
  chapterContent: string
  evidenceContext: string
}): ConsistencyAuditResult | null {
  const start = args.raw.indexOf('{')
  const end = args.raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(args.raw.slice(start, end + 1)) as { findings?: unknown }
    if (!Array.isArray(parsed.findings)) return null
    const findings = parsed.findings.flatMap((raw): ConsistencyFinding[] => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
      const item = raw as Record<string, unknown>
      const quote = String(item.quote ?? '').trim()
      if (!quote || !args.chapterContent.includes(quote)) return []
      const evidence = Array.isArray(item.evidence)
        ? item.evidence.flatMap((entry): ConsistencyFinding['evidence'] => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
            const value = entry as Record<string, unknown>
            const evidenceQuote = String(value.quote ?? '').trim()
            if (!evidenceQuote || !args.evidenceContext.includes(evidenceQuote)) return []
            const sourceType = ['canon', 'observation', 'chapter', 'summary'].includes(String(value.sourceType))
              ? String(value.sourceType) as ConsistencyFinding['evidence'][number]['sourceType']
              : 'observation'
            return [{
              sourceType,
              sourceId: Number.isFinite(Number(value.sourceId)) ? Number(value.sourceId) : 0,
              quote: evidenceQuote,
            }]
          })
        : []
      const requested = ['hard', 'risk', 'unknown'].includes(String(item.severity))
        ? String(item.severity) as ConsistencySeverity
        : 'unknown'
      const severity: ConsistencySeverity = requested === 'hard' && evidence.length === 0 ? 'unknown' : requested
      return [{
        category: String(item.category ?? '未分类'),
        severity,
        quote,
        evidence,
        reason: String(item.reason ?? '').trim(),
        suggestion: String(item.suggestion ?? '').trim() || undefined,
      }]
    })
    return { mode: args.mode, findings }
  } catch {
    return null
  }
}
