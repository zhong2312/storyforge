import type { ChatMessage } from '../../types'
import { renderPrompt } from '../prompt-engine'
import { usePromptStore } from '../../../stores/prompt'
import type { DeAIDiagnosis, DeAIIssue, DeAIIssueCategory, DeAIIssueSeverity, DeAIStrength, DeterministicScanReport } from './types'

const CATEGORY_SET = new Set<DeAIIssueCategory>([
  'template-wording', 'explicit-psychology', 'binary-contrast', 'signposting', 'over-summary',
  'generic-comfort', 'repeated-opening', 'uniform-rhythm', 'repetition', 'dialogue-tag',
  'mechanical-transition', 'format', 'other',
])
const SEVERITY_SET = new Set<DeAIIssueSeverity>(['low', 'medium', 'high'])

function extractJSONObject(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? raw
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1))
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function clampScore(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : fallback
}

export function parseDeAIDiagnosis(raw: string, sourceText: string, fallbackRiskScore: number): DeAIDiagnosis {
  const parsed = extractJSONObject(raw)
  if (!parsed) {
    return { riskScore: fallbackRiskScore, issues: [], integrityRisks: [], summary: '', parseWarning: '模型诊断不是有效 JSON，已仅使用本地扫描结果。' }
  }
  const issues: DeAIIssue[] = []
  const candidates = Array.isArray(parsed.issues) ? parsed.issues : []
  for (const candidate of candidates.slice(0, 40)) {
    if (!candidate || typeof candidate !== 'object') continue
    const item = candidate as Record<string, unknown>
    const evidence = String(item.evidence ?? '').trim().slice(0, 180)
    if (!evidence || !sourceText.includes(evidence)) continue
    const category = CATEGORY_SET.has(item.category as DeAIIssueCategory) ? item.category as DeAIIssueCategory : 'other'
    const severity = SEVERITY_SET.has(item.severity as DeAIIssueSeverity) ? item.severity as DeAIIssueSeverity : 'medium'
    issues.push({
      id: `model-${issues.length + 1}`,
      source: 'model',
      category,
      severity,
      evidence,
      reason: String(item.reason ?? '').trim().slice(0, 240),
      suggestion: String(item.suggestion ?? '').trim().slice(0, 240),
    })
  }
  return {
    riskScore: clampScore(parsed.riskScore, fallbackRiskScore),
    issues,
    integrityRisks: Array.isArray(parsed.integrityRisks)
      ? parsed.integrityRisks
        .map(value => String(value).trim())
        .filter(value => value && !/^(?:无|没有|未发现|none|no risks?)$/i.test(value))
        .slice(0, 12)
      : [],
    summary: String(parsed.summary ?? '').trim().slice(0, 400),
  }
}

function compactScan(report: DeterministicScanReport): string {
  return JSON.stringify({
    riskScore: report.riskScore,
    stats: report.stats,
    issues: report.issues.slice(0, 30).map(issue => ({
      category: issue.category,
      severity: issue.severity,
      evidence: issue.evidence,
      count: issue.count,
      reason: issue.reason,
    })),
  })
}

export function buildDeAIDetectPrompt(
  text: string,
  deterministicReport: DeterministicScanReport,
  phase: 'before' | 'after',
  originalText?: string,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('chapter.de-ai.detect')
  return renderPrompt(tpl, {
    text,
    phase,
    originalText: phase === 'after' ? originalText || '' : '',
    deterministicReport: compactScan(deterministicReport),
  }).messages
}

function issueBlock(issues: DeAIIssue[]): string {
  if (!issues.length) return '未发现必须修改的具体证据；不要为了改写而改写。'
  return issues.slice(0, 36).map((issue, index) => (
    `${index + 1}. [${issue.severity}/${issue.category}] 证据：“${issue.evidence}”\n原因：${issue.reason}\n处理：${issue.suggestion}`
  )).join('\n')
}

const STRENGTH_LABELS: Record<DeAIStrength, string> = {
  light: '轻度：只修明确证据，尽量保留原句和段落。',
  standard: '标准：定点重写问题句，并调整局部节奏和对白声口。',
  deep: '深度：允许重组段内句序和节奏，但不得改变剧情结构与事实。',
}

export function buildDeAIRewritePrompt(input: {
  text: string
  styleContext: string
  deterministicReport: DeterministicScanReport
  diagnosedIssues: DeAIIssue[]
  strength: DeAIStrength
  protectedTerms: string[]
}): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('chapter.de-ai')
  const values = {
    text: input.text,
    styleContext: input.styleContext || '（项目暂无可用文风、角色或创作规则，按原文自身声口处理。）',
    issuesBlock: issueBlock(input.diagnosedIssues),
    deterministicReport: compactScan(input.deterministicReport),
    strength: STRENGTH_LABELS[input.strength],
    protectedTerms: input.protectedTerms.join('、') || '（无）',
  }
  const { messages } = renderPrompt(tpl, values, {
    parameterValues: { aggressiveness: input.strength === 'light' ? '轻度' : input.strength === 'deep' ? '激进' : '中度' },
  })

  const contract = `【本次流水线写法合同（优先级高于泛化润色建议）】
改写力度：${values.strength}
受保护名称：${values.protectedTerms}
只处理下列有正文证据的问题：
${values.issuesBlock}

【项目文风与事实约束】
${values.styleContext}

硬约束：
1. 不新增、删除或调换剧情事件，不改变人物关系、立场、视角、时间、地点、因果和设定事实。
2. 数字、专名、物品、招式、称谓和对白信息不得丢失；原文没有的事实不得补写。
3. 逐段对应改写，保留段落与对白结构；成稿长度控制在原文 90%–110%。
4. 不随机添加口头禅、病句、错别字或网络热词来制造所谓“人味”。
5. 直接输出完整改写正文，不写标题、说明、分析、Markdown 代码块。`

  const lastUserIndex = messages.map(message => message.role).lastIndexOf('user')
  if (lastUserIndex >= 0) {
    messages[lastUserIndex] = { ...messages[lastUserIndex], content: `${messages[lastUserIndex].content}\n\n${contract}` }
  } else {
    messages.push({ role: 'user', content: `${input.text}\n\n${contract}` })
  }
  return messages
}

export function stripRewriteWrapper(raw: string): string {
  const trimmed = raw.trim()
  const match = trimmed.match(/^```(?:text|markdown|md)?\s*([\s\S]*?)```$/i)
  return (match?.[1] ?? trimmed).trim()
}
