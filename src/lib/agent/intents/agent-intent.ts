import { nanoid } from 'nanoid'
import type {
  AgentCompletionRequirement,
  AgentScope,
} from '../runtime/agent-runtime-port'
import type { ProjectLocator } from '../../storage/ports'
import type { PromptModuleKey } from '../../types/prompt'

const AGENT_INTENT_EVENT = 'storyforge:agent-intent'
const AGENT_PROJECT_COMMIT_EVENT = 'storyforge:agent-project-commit'

export const CHAPTER_WRITING_CONTEXT_SOURCES = Object.freeze([
  'contextMemo',
  'chapterContent',
  'chapterOutline',
  'detailedOutline',
  'chapterContinuityHandoff',
  'previousPlanReconciliation',
  'previousChapterEnding',
  'recentChapterSummaries',
  'worldview',
  'storyCore',
  'powerSystem',
  'codex',
  'characters',
  'creativeRules',
  'worldRules',
  'historical',
  'locations',
  'foreshadows',
  'storyArcs',
  'emotionBeats',
  'stateCards',
  'currentFacts',
  'heldItems',
  'retrievedPassages',
  'references',
  'userStyleProfile',
] as const)

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
  readonly promptModuleKey?: PromptModuleKey
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

export function inferChapterChatCompletionRequirement(
  message: string,
): AgentCompletionRequirement | undefined {
  const normalized = message.trim()
  const chapterReference = /(?:第[一二三四五六七八九十百零〇两\d]+章|本章|当前章|这一章|这章)/
  const writingCommand = /(?:写|续写|补写|扩写|缩写|重写|改写|优化|润色|修改|调整|精修|重构)/
  if (!chapterReference.test(normalized) || !writingCommand.test(normalized)) return undefined
  return {
    kind: 'change-proposal',
    target: 'chapters',
    mode: 'replace',
    requiredFields: ['content'],
    minTextLength: { content: 500 },
    requiredContextSources: ['chapterIndex', ...CHAPTER_WRITING_CONTEXT_SOURCES],
    deliverableKind: 'chapter-draft',
  }
}

export function inferAgentPromptModuleKey(message: string): PromptModuleKey | undefined {
  if (inferChapterChatCompletionRequirement(message)) {
    if (/(?:去\s*AI|去AI|去除.*AI|消除.*AI)/i.test(message)) return 'chapter.de-ai'
    if (/(?:续写|补写)/.test(message)) return 'chapter.continue'
    if (/(?:扩写)/.test(message)) return 'chapter.expand'
    if (/(?:润色|精修|优化)/.test(message)) return 'chapter.polish'
    return 'chapter.content'
  }
  const create = /(?:设计|生成|创建|新增|补全|完善|反推)/
  if (!create.test(message)) return undefined
  if (/(?:角色|人物)/.test(message)) return 'character.generate'
  if (/(?:卷纲|卷级大纲)/.test(message)) return 'outline.volume'
  if (/(?:章纲|章节大纲)/.test(message)) return 'outline.chapter'
  if (/(?:世界观|世界设定)/.test(message)) return 'worldview.dimension'
  if (/(?:故事核心|故事主线)/.test(message)) return 'story.generate'
  if (/(?:伏笔)/.test(message)) return 'foreshadow.generate'
  if (/(?:灵感)/.test(message)) return 'inspiration.reverse'
  return undefined
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
        intent.completionRequirement.requiredDataPaths?.length
          ? `必须包含精确数据路径：${intent.completionRequirement.requiredDataPaths.map(path => path.join(' → ')).join('、')}。`
          : '',
      ].join('\n')
    : ''

  return [
    `用户从 StoryForge 的“${intent.title}”功能发起任务。`,
    `任务类型：${intent.type}。${scope ? `当前作用域：${scope}。` : ''}`,
    intent.promptModuleKey ? `本任务使用提示词库模块：${intent.promptModuleKey}。` : '',
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
    requiredDataPaths: requirement.requiredDataPaths
      ? Object.freeze(requirement.requiredDataPaths.map(path => Object.freeze([...path])))
      : undefined,
    minTextLength: requirement.minTextLength
      ? Object.freeze({ ...requirement.minTextLength })
      : undefined,
    deliverableKind: requirement.deliverableKind,
    sourceTextLength: requirement.sourceTextLength,
    minLengthRatio: requirement.minLengthRatio,
    requiredContextSources: requirement.requiredContextSources
      ? Object.freeze([...requirement.requiredContextSources])
      : undefined,
    requiredPreProposalTools: requirement.requiredPreProposalTools
      ? Object.freeze([...requirement.requiredPreProposalTools])
      : undefined,
  })
}

export function isIntentForDexieProject(intent: AgentIntent, projectId: number): boolean {
  return intent.source.project.backend === 'dexie'
    && intent.source.project.projectId === projectId
}
