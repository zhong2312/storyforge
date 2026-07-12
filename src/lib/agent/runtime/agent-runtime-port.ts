import type { ProjectLocator } from '../../storage/ports'
import type { AgentEvent } from '../events/agent-events'

export interface AgentScope {
  worldGroupId?: number | null
  outlineNodeId?: number | null
  chapterId?: number | null
  module?: string
  entityId?: string | number | null
  selection?: { text: string; from?: number; to?: number }
}

export interface AgentChangeProposalCompletionRequirement {
  readonly kind: 'change-proposal'
  readonly target: string
  readonly mode: 'replace' | 'append' | 'add' | 'add-many' | 'merge-diffs'
  readonly recordId?: number
  readonly requiredFields: readonly string[]
  /** 嵌套结果的精确路径；每段独立存储，可安全包含点号（如 nodeId=era.period）。 */
  readonly requiredDataPaths?: readonly (readonly string[])[]
  readonly minTextLength?: Readonly<Record<string, number>>
  readonly requiredContextSources?: readonly string[]
  /** 提案前必须成功返回 canPropose=true 的质量门工具。 */
  readonly requiredPreProposalTools?: readonly string[]
  readonly deliverableKind?: 'chapter-draft' | 'chapter-rewrite' | 'structured-record'
  readonly sourceTextLength?: number
  readonly minLengthRatio?: number
}

export type AgentCompletionRequirement = AgentChangeProposalCompletionRequirement

export interface AgentPromptProfile {
  readonly moduleKey: string
  readonly name: string
  readonly systemPrompt: string
  readonly userPromptTemplate: string
  readonly parameterValues?: Readonly<Record<string, string | number | boolean>>
  readonly goodExamples?: readonly string[]
  readonly badExamples?: readonly string[]
  readonly modelOverride?: {
    readonly temperature?: number
    readonly maxTokens?: number
  }
}

export interface AgentHistoryMessage {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

export interface AgentRunInput {
  conversationId: string
  project: ProjectLocator
  scope: AgentScope
  userMessage: string
  conversationHistory?: readonly AgentHistoryMessage[]
  preferredAgent?: string
  modelProfile?: string
  maxSteps?: number
  tokenBudget?: number
  completionRequirement?: AgentCompletionRequirement
  promptProfile?: AgentPromptProfile
}

export interface ApprovalDecision {
  approvalId: string
  decision: 'approved' | 'edited' | 'rejected'
  editedPlan?: Record<string, unknown>
}

export interface AgentRuntimePort {
  run(input: AgentRunInput): AsyncIterable<AgentEvent>
  resume(runId: string, decision?: ApprovalDecision): AsyncIterable<AgentEvent>
  cancel(runId: string): Promise<void>
}
