import { nanoid } from 'nanoid'
import type {
  AgentCompletionRequirement,
  AgentScope,
} from '../runtime/agent-runtime-port'
import type { ProjectLocator } from '../../storage/ports'

const AGENT_INTENT_EVENT = 'storyforge:agent-intent'
const AGENT_PROJECT_COMMIT_EVENT = 'storyforge:agent-project-commit'

export interface AgentIntentSource extends AgentScope {
  readonly project: ProjectLocator
  readonly field?: string
}

export interface AgentIntent {
  readonly id: string
  readonly type: string
  readonly title: string
  readonly source: AgentIntentSource
  readonly instruction: string
  readonly payload?: Readonly<Record<string, unknown>>
  readonly completionRequirement?: AgentCompletionRequirement
}

export type NewAgentIntent = Omit<AgentIntent, 'id'> & { readonly id?: string }

export interface AgentProjectCommit {
  readonly project: ProjectLocator
  readonly scope: AgentScope
  readonly intentType?: string
}

export function dispatchAgentIntent(input: NewAgentIntent): AgentIntent {
  const intent: AgentIntent = Object.freeze({
    ...input,
    id: input.id ?? nanoid(),
    source: Object.freeze({ ...input.source }),
    payload: input.payload ? Object.freeze(structuredClone(input.payload)) : undefined,
    completionRequirement: input.completionRequirement
      ? freezeCompletionRequirement(input.completionRequirement)
      : undefined,
  })
  if (typeof window === 'undefined') {
    throw new Error('[agent-intent] browser window is required')
  }
  window.dispatchEvent(new CustomEvent<AgentIntent>(AGENT_INTENT_EVENT, { detail: intent }))
  return intent
}

export function subscribeAgentIntents(listener: (intent: AgentIntent) => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const handler = (event: Event) => listener((event as CustomEvent<AgentIntent>).detail)
  window.addEventListener(AGENT_INTENT_EVENT, handler)
  return () => window.removeEventListener(AGENT_INTENT_EVENT, handler)
}

export function dispatchAgentProjectCommit(commit: AgentProjectCommit): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<AgentProjectCommit>(AGENT_PROJECT_COMMIT_EVENT, {
    detail: Object.freeze({
      ...commit,
      scope: Object.freeze({ ...commit.scope }),
    }),
  }))
}

export function subscribeAgentProjectCommits(
  listener: (commit: AgentProjectCommit) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined
  const handler = (event: Event) => listener((event as CustomEvent<AgentProjectCommit>).detail)
  window.addEventListener(AGENT_PROJECT_COMMIT_EVENT, handler)
  return () => window.removeEventListener(AGENT_PROJECT_COMMIT_EVENT, handler)
}

export function agentScopeFromIntent(intent: AgentIntent): AgentScope {
  const { source } = intent
  return {
    module: source.module,
    worldGroupId: source.worldGroupId,
    outlineNodeId: source.outlineNodeId,
    chapterId: source.chapterId,
    entityId: source.entityId,
    selection: source.selection,
  }
}

export function buildAgentIntentPrompt(intent: AgentIntent): string {
  const scope = [
    intent.source.module ? `模块=${intent.source.module}` : '',
    intent.source.field ? `字段=${intent.source.field}` : '',
    intent.source.worldGroupId != null ? `世界ID=${intent.source.worldGroupId}` : '',
    intent.source.outlineNodeId != null ? `大纲节点ID=${intent.source.outlineNodeId}` : '',
    intent.source.chapterId != null ? `章节ID=${intent.source.chapterId}` : '',
    intent.source.entityId != null ? `实体ID=${intent.source.entityId}` : '',
  ].filter(Boolean).join('；')
  const payload = intent.payload && Object.keys(intent.payload).length > 0
    ? `\n当前面板输入：\n${JSON.stringify(intent.payload, null, 2)}`
    : ''
  const selection = intent.source.selection?.text
    ? `\n用户选区：\n${intent.source.selection.text}`
    : ''
  const completion = intent.completionRequirement?.kind === 'change-proposal'
    ? [
        '本任务只有在生成可供用户审阅的变更方案后才算完成。',
        `方案必须使用 storyforge.change.propose：target=${intent.completionRequirement.target}，mode=${intent.completionRequirement.mode}${intent.completionRequirement.recordId != null ? `，recordId=${intent.completionRequirement.recordId}` : ''}，必填字段=${intent.completionRequirement.requiredFields.join('、')}。`,
      ].join('\n')
    : ''

  return [
    `用户从 StoryForge 的“${intent.title}”功能发起任务。`,
    `任务类型：${intent.type}。${scope ? `当前作用域：${scope}。` : ''}`,
    intent.instruction,
    '请复用当前项目工具完成：先读取与该功能相关的项目事实，再生成结果。',
    '如果结果应写入项目，必须调用 storyforge.change.propose 生成审批方案；不得只给一段无法采纳的泛泛建议，也不得声称已经写入。',
    completion,
    payload,
    selection,
  ].filter(Boolean).join('\n')
}

function freezeCompletionRequirement(
  requirement: AgentCompletionRequirement,
): AgentCompletionRequirement {
  return Object.freeze({
    ...structuredClone(requirement),
    requiredFields: Object.freeze([...requirement.requiredFields]),
    minTextLength: requirement.minTextLength
      ? Object.freeze({ ...requirement.minTextLength })
      : undefined,
    requiredContextSources: requirement.requiredContextSources
      ? Object.freeze([...requirement.requiredContextSources])
      : undefined,
  })
}

export function isIntentForDexieProject(intent: AgentIntent, projectId: number): boolean {
  return intent.source.project.backend === 'dexie'
    && intent.source.project.projectId === projectId
}
