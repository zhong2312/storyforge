import type { AgentEvent } from '../events/agent-events'
import type { AgentHistoryMessage } from '../runtime/agent-runtime-port'

const STORAGE_PREFIX = 'storyforge:agent-conversations:v1:'
const STATE_VERSION = 1
const MAX_GROUPS = 30
const MAX_CONVERSATIONS = 60
const MAX_EVENTS_PER_TURN = 200

export interface AgentConversationTurn {
  readonly id: string
  readonly userMessage: string
  runId?: string
  assistantMessage: string
  events: AgentEvent[]
  waitingApproval?: Extract<AgentEvent, { type: 'approval.requested' }>
  error?: string
}

export interface AgentConversationGroup {
  readonly id: string
  label: string
  readonly custom: boolean
  readonly order: number
}

export interface AgentConversation {
  readonly id: string
  readonly projectId: number
  title: string
  groupId: string
  sourceModule: string
  readonly createdAt: number
  updatedAt: number
  turns: AgentConversationTurn[]
}

export interface AgentConversationState {
  readonly version: 1
  readonly projectId: number
  groups: AgentConversationGroup[]
  conversations: AgentConversation[]
}

export interface ConversationStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const DEFAULT_GROUPS: readonly AgentConversationGroup[] = Object.freeze([
  { id: 'project', label: '项目', custom: false, order: 0 },
  { id: 'settings', label: '设定', custom: false, order: 1 },
  { id: 'characters', label: '角色', custom: false, order: 2 },
  { id: 'outline', label: '大纲', custom: false, order: 3 },
  { id: 'chapters', label: '正文', custom: false, order: 4 },
  { id: 'other', label: '其他', custom: false, order: 5 },
])

export function createAgentConversationState(projectId: number): AgentConversationState {
  return {
    version: STATE_VERSION,
    projectId,
    groups: DEFAULT_GROUPS.map(group => ({ ...group })),
    conversations: [],
  }
}

export function createAgentConversation(input: {
  id: string
  projectId: number
  module: string
  title?: string
  now?: number
}): AgentConversation {
  const now = input.now ?? Date.now()
  return {
    id: input.id,
    projectId: input.projectId,
    title: normalizeTitle(input.title || '新对话'),
    groupId: defaultConversationGroupId(input.module),
    sourceModule: input.module || 'other',
    createdAt: now,
    updatedAt: now,
    turns: [],
  }
}

export function defaultConversationGroupId(module: string): string {
  const normalized = module.toLowerCase()
  if (matches(normalized, ['chapter', 'editor', 'review', 'state', 'item', 'timeline', 'scene'])) return 'chapters'
  if (matches(normalized, ['character', 'relation'])) return 'characters'
  if (matches(normalized, ['outline', 'story-arc', 'storyarc', 'plot', 'foreshadow'])) return 'outline'
  if (matches(normalized, [
    'world', 'geography', 'history', 'location', 'codex', 'rule', 'power', 'humanity', 'natural',
  ])) return 'settings'
  if (matches(normalized, ['project', 'inspiration', 'reference'])) return 'project'
  return 'other'
}

export function loadAgentConversationState(
  projectId: number,
  storage: ConversationStorage = localStorage,
): AgentConversationState {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(storageKey(projectId)) || 'null')
    if (!isRecord(parsed) || parsed.version !== STATE_VERSION || parsed.projectId !== projectId) {
      return createAgentConversationState(projectId)
    }
    const groups = normalizeGroups(parsed.groups)
    const knownGroups = new Set(groups.map(group => group.id))
    const conversations = Array.isArray(parsed.conversations)
      ? parsed.conversations
        .map(value => normalizeConversation(value, projectId, knownGroups))
        .filter((value): value is AgentConversation => value != null)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_CONVERSATIONS)
      : []
    return { version: STATE_VERSION, projectId, groups, conversations }
  } catch {
    return createAgentConversationState(projectId)
  }
}

export function saveAgentConversationState(
  state: AgentConversationState,
  storage: ConversationStorage = localStorage,
): void {
  const groups = normalizeGroups(state.groups)
  const knownGroups = new Set(groups.map(group => group.id))
  const conversations = state.conversations
    .map(value => normalizeConversation(value, state.projectId, knownGroups, true))
    .filter((value): value is AgentConversation => value != null)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_CONVERSATIONS)
  try {
    storage.setItem(storageKey(state.projectId), JSON.stringify({
      version: STATE_VERSION,
      projectId: state.projectId,
      groups,
      conversations,
    }))
  } catch {
    // Conversation history is a local convenience cache; project writes must not fail with it.
  }
}

export function conversationTitle(message: string): string {
  return normalizeTitle(message.replace(/\s+/g, ' ').trim() || '新对话')
}

export function buildAgentConversationHistory(
  turns: readonly AgentConversationTurn[],
): AgentHistoryMessage[] {
  return turns.flatMap(turn => {
    const userMessage = turn.userMessage.trim()
    const assistantParts = [
      ...turn.events.flatMap(event => event.type === 'tool.completed' && event.payload.output !== undefined
        ? [`【工具输出：${event.payload.toolName}】\n${serializeToolOutput(event.payload.output)}`]
        : []),
      ...turn.events.flatMap(event => event.type === 'approval.requested' && event.payload.preview
        ? [`【正式候选方案】\n${serializeToolOutput(event.payload.preview)}`]
        : []),
      turn.assistantMessage.trim(),
    ].filter(Boolean)
    if (!userMessage || !assistantParts.length || turn.error) return []
    return [
      { role: 'user' as const, content: userMessage },
      { role: 'assistant' as const, content: assistantParts.join('\n\n') },
    ]
  })
}

function normalizeConversation(
  value: unknown,
  projectId: number,
  knownGroups: ReadonlySet<string>,
  forStorage = false,
): AgentConversation | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.projectId !== projectId) return null
  const sourceModule = typeof value.sourceModule === 'string' ? value.sourceModule : 'other'
  const fallbackGroup = defaultConversationGroupId(sourceModule)
  const groupId = typeof value.groupId === 'string' && knownGroups.has(value.groupId)
    ? value.groupId
    : fallbackGroup
  const turns = Array.isArray(value.turns)
    ? value.turns
      .map(turn => normalizeTurn(turn, forStorage))
      .filter((turn): turn is AgentConversationTurn => turn != null)
    : []
  return {
    id: value.id,
    projectId,
    title: normalizeTitle(typeof value.title === 'string' ? value.title : '新对话'),
    groupId,
    sourceModule,
    createdAt: finiteNumber(value.createdAt, Date.now()),
    updatedAt: finiteNumber(value.updatedAt, Date.now()),
    turns,
  }
}

function normalizeTurn(value: unknown, forStorage: boolean): AgentConversationTurn | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.userMessage !== 'string') return null
  const events = Array.isArray(value.events)
    ? compactAgentEvents(value.events.filter(isAgentEventLike) as AgentEvent[], forStorage)
      .slice(-MAX_EVENTS_PER_TURN)
    : []
  const waitingApproval = isAgentEventLike(value.waitingApproval)
    && value.waitingApproval.type === 'approval.requested'
    ? value.waitingApproval as Extract<AgentEvent, { type: 'approval.requested' }>
    : undefined
  const restoredPending = !forStorage && waitingApproval != null
  return {
    id: value.id,
    userMessage: value.userMessage,
    runId: typeof value.runId === 'string' ? value.runId : undefined,
    assistantMessage: typeof value.assistantMessage === 'string' ? value.assistantMessage : '',
    events,
    waitingApproval: forStorage ? waitingApproval : undefined,
    error: restoredPending
      ? '页面已重新加载，原审批运行已失效，请重新发起任务。'
      : typeof value.error === 'string' ? value.error : undefined,
  }
}

function serializeToolOutput(value: unknown): string {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(value, (_key, item) => {
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) return '[循环引用]'
        seen.add(item)
      }
      return item
    }, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function compactAgentEvents(events: AgentEvent[], forStorage: boolean): AgentEvent[] {
  if (!forStorage) return events
  const compacted: AgentEvent[] = []
  for (const event of events) {
    const previous = compacted[compacted.length - 1]
    const mergeable = event.type === 'message.delta' || event.type === 'reasoning.summary.delta'
    if (mergeable && previous?.type === event.type && previous.runId === event.runId) {
      compacted[compacted.length - 1] = {
        ...previous,
        payload: { text: previous.payload.text + event.payload.text },
      } as AgentEvent
    } else {
      compacted.push(event)
    }
  }
  return compacted
}

function normalizeGroups(value: unknown): AgentConversationGroup[] {
  const custom = Array.isArray(value)
    ? value
      .filter((group): group is Record<string, unknown> & { id: string; label: string; custom: true } => (
        isRecord(group)
        && group.custom === true
        && typeof group.id === 'string'
        && typeof group.label === 'string'
      ))
      .slice(0, MAX_GROUPS - DEFAULT_GROUPS.length)
      .map((group, index) => ({
        id: group.id,
        label: normalizeGroupLabel(group.label),
        custom: true,
        order: DEFAULT_GROUPS.length + index,
      }))
    : []
  const ids = new Set(DEFAULT_GROUPS.map(group => group.id))
  return [
    ...DEFAULT_GROUPS.map(group => ({ ...group })),
    ...custom.filter(group => !ids.has(group.id)),
  ]
}

function normalizeTitle(value: string): string {
  return value.trim().slice(0, 40) || '新对话'
}

function normalizeGroupLabel(value: string): string {
  return value.trim().slice(0, 12) || '自定义'
}

function storageKey(projectId: number): string {
  return `${STORAGE_PREFIX}${projectId}`
}

function matches(module: string, candidates: readonly string[]): boolean {
  return candidates.some(candidate => module.includes(candidate))
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isAgentEventLike(value: unknown): value is AgentEvent {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.type === 'string'
    && typeof value.runId === 'string'
    && typeof value.conversationId === 'string'
    && typeof value.sequence === 'number'
    && typeof value.timestamp === 'number'
    && isRecord(value.payload)
}
