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
  readonly minTextLength?: Readonly<Record<string, number>>
  readonly requiredContextSources?: readonly string[]
  readonly deliverableKind?: 'chapter-draft' | 'chapter-rewrite' | 'structured-record'
  readonly sourceTextLength?: number
  readonly minLengthRatio?: number
}

export type AgentCompletionRequirement = AgentChangeProposalCompletionRequirement

export interface AgentRunInput {
  conversationId: string
  project: ProjectLocator
  scope: AgentScope
  userMessage: string
  preferredAgent?: string
  modelProfile?: string
  maxSteps?: number
  tokenBudget?: number
  completionRequirement?: AgentCompletionRequirement
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
