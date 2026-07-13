import type { ChatMessage } from '../../types'

export type DeAIStrength = 'light' | 'standard' | 'deep'
export type DeAIPipelineStage = 'scan' | 'detect' | 'rewrite' | 'verify'
export type DeAIIssueSeverity = 'low' | 'medium' | 'high'

export type DeAIIssueCategory =
  | 'template-wording'
  | 'explicit-psychology'
  | 'binary-contrast'
  | 'signposting'
  | 'over-summary'
  | 'generic-comfort'
  | 'repeated-opening'
  | 'uniform-rhythm'
  | 'repetition'
  | 'dialogue-tag'
  | 'mechanical-transition'
  | 'format'
  | 'other'

export interface DeAIIssue {
  id: string
  source: 'deterministic' | 'model'
  category: DeAIIssueCategory
  severity: DeAIIssueSeverity
  evidence: string
  reason: string
  suggestion: string
  count?: number
}

export interface DeterministicScanReport {
  riskScore: number
  issues: DeAIIssue[]
  stats: {
    characters: number
    paragraphs: number
    sentences: number
    dialogueMarks: number
    sentenceLengthVariation: number
    paragraphLengthVariation: number
  }
}

export interface DeAIDiagnosis {
  riskScore: number
  issues: DeAIIssue[]
  integrityRisks: string[]
  summary: string
  parseWarning?: string
}

export interface DeAISafetyCheck {
  blocked: boolean
  warnings: string[]
  lengthRatio: number
  missingNumbers: string[]
  missingProtectedTerms: string[]
  paragraphRatio: number
  dialogueMarkRatio: number
}

export interface DeAIPipelineResult {
  originalText: string
  rewrittenText: string
  beforeScan: DeterministicScanReport
  afterScan: DeterministicScanReport
  beforeDiagnosis: DeAIDiagnosis
  afterDiagnosis: DeAIDiagnosis
  safety: DeAISafetyCheck
  fixedIssueCount: number
  blocked: boolean
  blockedReason?: string
}

export type DeAIPipelineCall = (
  stage: Exclude<DeAIPipelineStage, 'scan'>,
  messages: ChatMessage[],
) => Promise<string>
