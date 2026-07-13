import { buildDeAIDetectPrompt, buildDeAIRewritePrompt, parseDeAIDiagnosis, stripRewriteWrapper } from './adapter'
import { checkDeAISafety, scanDeAIText } from './deterministic-scan'
import type { DeAIPipelineCall, DeAIPipelineResult, DeAIPipelineStage, DeAIStrength } from './types'

export async function runDeAIPipeline(input: {
  text: string
  styleContext: string
  strength: DeAIStrength
  protectedTerms?: string[]
  call: DeAIPipelineCall
  onStage?: (stage: DeAIPipelineStage) => void
}): Promise<DeAIPipelineResult> {
  input.onStage?.('scan')
  const beforeScan = scanDeAIText(input.text)

  input.onStage?.('detect')
  const beforeRaw = await input.call('detect', buildDeAIDetectPrompt(input.text, beforeScan, 'before'))
  const beforeDiagnosis = parseDeAIDiagnosis(beforeRaw, input.text, beforeScan.riskScore)
  const diagnosedIssues = [...beforeScan.issues, ...beforeDiagnosis.issues]

  input.onStage?.('rewrite')
  const rewrittenRaw = await input.call('rewrite', buildDeAIRewritePrompt({
    text: input.text,
    styleContext: input.styleContext,
    deterministicReport: beforeScan,
    diagnosedIssues,
    strength: input.strength,
    protectedTerms: input.protectedTerms ?? [],
  }))
  const rewrittenText = stripRewriteWrapper(rewrittenRaw)
  if (!rewrittenText) throw new Error('模型没有返回可用的改写正文。')

  input.onStage?.('verify')
  const afterScan = scanDeAIText(rewrittenText)
  const safety = checkDeAISafety(input.text, rewrittenText, input.protectedTerms)
  const afterRaw = await input.call('verify', buildDeAIDetectPrompt(rewrittenText, afterScan, 'after', input.text))
  const afterDiagnosis = parseDeAIDiagnosis(afterRaw, rewrittenText, afterScan.riskScore)
  const integrityBlocked = afterDiagnosis.integrityRisks.length > 0
  const blocked = safety.blocked || integrityBlocked
  const blockedReason = [
    ...safety.warnings,
    ...afterDiagnosis.integrityRisks.map(risk => `模型复检：${risk}`),
  ].join('；') || undefined
  const beforeIssueCount = beforeScan.issues.length + beforeDiagnosis.issues.length
  const afterIssueCount = afterScan.issues.length + afterDiagnosis.issues.length

  return {
    originalText: input.text,
    rewrittenText,
    beforeScan,
    afterScan,
    beforeDiagnosis,
    afterDiagnosis,
    safety,
    fixedIssueCount: Math.max(0, beforeIssueCount - afterIssueCount),
    blocked,
    blockedReason,
  }
}
