import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleStop,
  FolderPlus,
  History,
  LoaderCircle,
  MessageSquarePlus,
  PanelRight,
  Pencil,
  Plug,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  Wrench,
  X,
  XCircle,
} from 'lucide-react'
import { nanoid } from 'nanoid'
import AutoResizeTextarea from '../shared/AutoResizeTextarea'
import { isTerminalAgentEvent, type AgentEvent } from '../../lib/agent/events/agent-events'
import { AiSdkAgentRuntimeAdapter } from '../../lib/agent/runtime/ai-sdk'
import { ToolRegistry } from '../../lib/agent/tools/tool-registry'
import { AdoptionPlanStore, createStoryForgeTools } from '../../lib/agent/tools/internal'
import {
  createMcpServerConfig,
  loadMcpServerConfigs,
  McpToolProvider,
  saveMcpServerConfigs,
  type McpServerConfig,
} from '../../lib/agent/mcp'
import { DexieProjectStorage } from '../../lib/storage/adapters/dexie'
import { useAIConfigStore } from '../../stores/ai-config'
import type { AgentScope } from '../../lib/agent/runtime/agent-runtime-port'
import {
  agentScopeFromIntent,
  buildAgentIntentPrompt,
  dispatchAgentProjectCommit,
  type AgentIntent,
} from '../../lib/agent/intents'
import {
  conversationTitle,
  createAgentConversation,
  createAgentConversationState,
  defaultConversationGroupId,
  loadAgentConversationState,
  saveAgentConversationState,
  type AgentConversation,
  type AgentConversationGroup,
  type AgentConversationState,
  type AgentConversationTurn,
} from '../../lib/agent/conversations'

interface Props {
  projectId: number
  activeModule: string
  worldGroupId?: number | null
  intent?: AgentIntent | null
  onIntentConsumed?: (intentId: string) => void
  onClose: () => void
  onOpenProperties: () => void
  onOpenSettings: () => void
  onProjectChanged: () => Promise<void>
}

interface AgentResources {
  readonly runtime: AiSdkAgentRuntimeAdapter
  readonly mcp: McpToolProvider
  readonly storage: DexieProjectStorage
}

export default function AgentDock({
  projectId,
  activeModule,
  worldGroupId,
  intent,
  onIntentConsumed,
  onClose,
  onOpenProperties,
  onOpenSettings,
  onProjectChanged,
}: Props) {
  const model = useAIConfigStore(state => state.config.model)
  const baseUrl = useAIConfigStore(state => state.config.baseUrl)
  const [input, setInput] = useState('')
  const [conversationState, setConversationState] = useState<AgentConversationState>(() => (
    ensureConversationState(loadAgentConversationState(projectId), projectId, activeModule)
  ))
  const [activeConversationId, setActiveConversationId] = useState(() => conversationState.conversations[0].id)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'chat' | 'history' | 'connections'>('chat')
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>(loadMcpServerConfigs)
  const [mcpStatus, setMcpStatus] = useState<Record<string, string>>({})
  const configRef = useRef(mcpServers)
  const activeModuleRef = useRef(activeModule)
  activeModuleRef.current = activeModule
  const resources = useMemo<AgentResources>(() => createResources(projectId, configRef, setMcpStatus), [projectId])
  const currentRunIdRef = useRef<string | null>(null)
  const handledIntentIdsRef = useRef(new Set<string>())
  const runContextRef = useRef(new Map<string, { scope: AgentScope; intentType?: string }>())
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeConversation = conversationState.conversations.find(item => item.id === activeConversationId)
    ?? conversationState.conversations[0]!
  const turns = activeConversation.turns
  const pendingApproval = turns.find(turn => turn.waitingApproval)?.waitingApproval
  const hasPendingApproval = conversationState.conversations.some(conversation => (
    conversation.turns.some(turn => turn.waitingApproval)
  ))

  useEffect(() => {
    configRef.current = mcpServers
    saveMcpServerConfigs(mcpServers)
  }, [mcpServers])

  useEffect(() => {
    const restored = ensureConversationState(loadAgentConversationState(projectId), projectId, activeModuleRef.current)
    setConversationState(restored)
    setActiveConversationId(restored.conversations[0].id)
    currentRunIdRef.current = null
    handledIntentIdsRef.current.clear()
    runContextRef.current.clear()
  }, [projectId])

  useEffect(() => {
    if (conversationState.projectId !== projectId) return
    const timer = window.setTimeout(() => saveAgentConversationState(conversationState), 250)
    return () => window.clearTimeout(timer)
  }, [conversationState, projectId])

  useEffect(() => () => {
    void resources.runtime.cancel(currentRunIdRef.current ?? '')
    void resources.mcp.close()
    void resources.storage.close()
  }, [resources])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, busy, activeConversationId])

  const patchConversation = useCallback((
    conversationId: string,
    updater: (conversation: AgentConversation) => AgentConversation,
  ) => {
    setConversationState(current => ({
      ...current,
      conversations: current.conversations.map(conversation => (
        conversation.id === conversationId ? updater(conversation) : conversation
      )),
    }))
  }, [])

  const patchTurn = useCallback((
    conversationId: string,
    turnId: string,
    updater: (turn: AgentConversationTurn) => AgentConversationTurn,
  ) => {
    patchConversation(conversationId, conversation => ({
      ...conversation,
      updatedAt: Date.now(),
      turns: conversation.turns.map(turn => turn.id === turnId ? updater(turn) : turn),
    }))
  }, [patchConversation])

  const consumeEvents = useCallback(async (
    conversationId: string,
    turnId: string,
    stream: AsyncIterable<AgentEvent>,
  ) => {
    for await (const event of stream) {
      currentRunIdRef.current = event.runId
      patchTurn(conversationId, turnId, turn => reduceTurn(turn, event))
      if (event.type === 'tool.completed'
        && event.payload.toolName === 'storyforge.change.commit') {
        await onProjectChanged()
        const runContext = runContextRef.current.get(turnId)
        if (runContext) {
          dispatchAgentProjectCommit({
            project: { backend: 'dexie', projectId },
            scope: runContext.scope,
            intentType: runContext.intentType,
          })
          runContextRef.current.delete(turnId)
        }
      }
      if (isTerminalAgentEvent(event)) runContextRef.current.delete(turnId)
    }
  }, [onProjectChanged, patchTurn, projectId])

  const runMessage = useCallback(async (
    rawMessage: string,
    scope: AgentScope,
    displayMessage = rawMessage,
    intentType?: string,
    forceNewConversation = false,
  ) => {
    const message = rawMessage.trim()
    if (!message || busy || hasPendingApproval) return
    const currentConversation = conversationState.conversations.find(item => item.id === activeConversationId)
    const shouldCreate = !currentConversation || (forceNewConversation && currentConversation.turns.length > 0)
    const targetConversation = shouldCreate
      ? createAgentConversation({
          id: `project-${projectId}-${nanoid(8)}`,
          projectId,
          module: scope.module || activeModule,
          title: displayMessage,
        })
      : currentConversation
    const conversationId = targetConversation.id
    const turnId = nanoid()
    setInput('')
    setBusy(true)
    runContextRef.current.set(turnId, { scope, intentType })
    const turn: AgentConversationTurn = {
      id: turnId, userMessage: displayMessage, assistantMessage: '', events: [],
    }
    setConversationState(current => {
      const exists = current.conversations.some(item => item.id === conversationId)
      const conversations = exists ? current.conversations : [targetConversation, ...current.conversations]
      return {
        ...current,
        conversations: conversations.map(conversation => conversation.id === conversationId
          ? {
              ...conversation,
              title: conversation.turns.length === 0 ? conversationTitle(displayMessage) : conversation.title,
              groupId: conversation.turns.length === 0
                ? defaultConversationGroupId(scope.module || activeModule)
                : conversation.groupId,
              sourceModule: conversation.turns.length === 0
                ? scope.module || activeModule
                : conversation.sourceModule,
              updatedAt: Date.now(),
              turns: [...conversation.turns, turn],
            }
          : conversation),
      }
    })
    setActiveConversationId(conversationId)

    try {
      const stream = resources.runtime.run({
        conversationId,
        project: { backend: 'dexie', projectId },
        scope,
        userMessage: message,
      })
      await consumeEvents(conversationId, turnId, stream)
    } finally {
      setBusy(false)
      currentRunIdRef.current = null
    }
  }, [activeConversationId, activeModule, busy, consumeEvents, conversationState.conversations, hasPendingApproval, projectId, resources.runtime])

  const send = async () => {
    await runMessage(input, { module: activeModule, worldGroupId })
  }

  useEffect(() => {
    if (!intent || busy || pendingApproval || handledIntentIdsRef.current.has(intent.id)) return
    handledIntentIdsRef.current.add(intent.id)
    onIntentConsumed?.(intent.id)
    setView('chat')
    void runMessage(
      buildAgentIntentPrompt(intent),
      agentScopeFromIntent(intent),
      intent.title,
      intent.type,
      true,
    )
  }, [busy, intent, onIntentConsumed, pendingApproval, runMessage])

  const resolveApproval = async (turn: AgentConversationTurn, decision: 'approved' | 'rejected') => {
    if (!turn.runId || !turn.waitingApproval || busy) return
    setBusy(true)
    try {
      await consumeEvents(activeConversation.id, turn.id, resources.runtime.resume(turn.runId, {
        approvalId: turn.waitingApproval.payload.approvalId,
        decision,
      }))
    } finally {
      if (decision === 'rejected') runContextRef.current.delete(turn.id)
      setBusy(false)
      currentRunIdRef.current = null
    }
  }

  const startNewConversation = () => {
    if (busy || hasPendingApproval) return
    const conversation = createAgentConversation({
      id: `project-${projectId}-${nanoid(8)}`,
      projectId,
      module: activeModule,
    })
    setConversationState(current => ({ ...current, conversations: [conversation, ...current.conversations] }))
    setActiveConversationId(conversation.id)
    setView('chat')
  }

  const renameConversation = (conversationId: string, title: string) => {
    patchConversation(conversationId, conversation => ({
      ...conversation,
      title: conversationTitle(title),
      updatedAt: Date.now(),
    }))
  }

  const moveConversation = (conversationId: string, groupId: string) => {
    if (!conversationState.groups.some(group => group.id === groupId)) return
    patchConversation(conversationId, conversation => ({ ...conversation, groupId, updatedAt: Date.now() }))
  }

  const addConversationGroup = (label: string) => {
    const normalized = label.trim().slice(0, 12)
    if (!normalized) return
    setConversationState(current => ({
      ...current,
      groups: [...current.groups, {
        id: `custom-${nanoid(8)}`,
        label: normalized,
        custom: true,
        order: current.groups.length,
      }],
    }))
  }

  const deleteConversationGroup = (groupId: string) => {
    const group = conversationState.groups.find(item => item.id === groupId)
    if (!group?.custom) return
    setConversationState(current => ({
      ...current,
      groups: current.groups.filter(item => item.id !== groupId),
      conversations: current.conversations.map(conversation => (
        conversation.groupId === groupId ? { ...conversation, groupId: 'other' } : conversation
      )),
    }))
  }

  const renameConversationGroup = (groupId: string, label: string) => {
    const normalized = label.trim().slice(0, 12)
    if (!normalized) return
    setConversationState(current => ({
      ...current,
      groups: current.groups.map(group => (
        group.id === groupId && group.custom ? { ...group, label: normalized } : group
      )),
    }))
  }

  const deleteConversation = (conversationId: string) => {
    if (busy) return
    const target = conversationState.conversations.find(item => item.id === conversationId)
    if (target?.turns.some(turn => turn.waitingApproval)) return
    const remaining = conversationState.conversations.filter(item => item.id !== conversationId)
    if (remaining.length > 0) {
      setConversationState(current => ({
        ...current,
        conversations: current.conversations.filter(item => item.id !== conversationId),
      }))
      if (activeConversationId === conversationId) setActiveConversationId(remaining[0].id)
      return
    }
    const replacement = createAgentConversation({
      id: `project-${projectId}-${nanoid(8)}`,
      projectId,
      module: activeModule,
    })
    setConversationState(current => ({ ...current, conversations: [replacement] }))
    setActiveConversationId(replacement.id)
  }

  const stop = async () => {
    if (currentRunIdRef.current) await resources.runtime.cancel(currentRunIdRef.current)
  }

  const testMcp = async (server: McpServerConfig) => {
    setMcpStatus(current => ({ ...current, [server.id]: '连接中' }))
    const result = await resources.mcp.load([{ ...server, enabled: true }])
    setMcpStatus(current => ({
      ...current,
      [server.id]: result.errors[0]?.message || `已连接 · ${result.tools.length} 个工具`,
    }))
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[400px] shrink-0 flex-col border-l border-border bg-bg-surface shadow-2xl lg:static lg:z-auto lg:w-[380px] lg:shadow-none">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-accent text-white">
          <Bot className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-text-primary">StoryForge Agent</div>
          <div className="truncate text-[10px] text-text-muted">{model || '未配置模型'}</div>
        </div>
        <button
          type="button"
          onClick={() => setView(value => value === 'history' ? 'chat' : 'history')}
          disabled={busy}
          className={`rounded p-1.5 transition-colors hover:bg-bg-hover disabled:opacity-40 ${view === 'history' ? 'text-accent' : 'text-text-muted hover:text-text-primary'}`}
          title="对话历史"
          aria-label="对话历史"
        >
          <History className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpenProperties}
          className="rounded p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
          title="打开属性面板"
          aria-label="打开属性面板"
        >
          <PanelRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setView(value => value === 'chat' ? 'connections' : 'chat')}
          className={`rounded p-1.5 transition-colors hover:bg-bg-hover ${view === 'connections' ? 'text-accent' : 'text-text-muted hover:text-text-primary'}`}
          title="MCP 连接"
          aria-label="MCP 连接"
        >
          <Settings2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1.5 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
          title="关闭 Agent"
          aria-label="关闭 Agent"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {view === 'connections' ? (
        <McpConnections
          servers={mcpServers}
          statuses={mcpStatus}
          onChange={setMcpServers}
          onTest={testMcp}
          onBack={() => setView('chat')}
        />
      ) : view === 'history' ? (
        <ConversationHistory
          groups={conversationState.groups}
          conversations={conversationState.conversations}
          activeConversationId={activeConversation.id}
          busy={busy}
          onBack={() => setView('chat')}
          onSelect={conversationId => {
            setActiveConversationId(conversationId)
            setView('chat')
          }}
          onNew={startNewConversation}
          onAddGroup={addConversationGroup}
          onRenameGroup={renameConversationGroup}
          onDeleteGroup={deleteConversationGroup}
          onRenameConversation={renameConversation}
          onMoveConversation={moveConversation}
          onDeleteConversation={deleteConversation}
        />
      ) : (
        <>
          <ConversationToolbar
            conversation={activeConversation}
            groups={conversationState.groups}
            busy={busy}
            blocked={hasPendingApproval}
            onShowHistory={() => setView('history')}
            onNew={startNewConversation}
            onMove={groupId => moveConversation(activeConversation.id, groupId)}
          />
          <div className="flex-1 overflow-y-auto px-3 py-4">
            {turns.length === 0 ? (
              <EmptyConversation onUse={setInput} />
            ) : (
              <div className="space-y-5">
                {turns.map(turn => (
                  <TurnView
                    key={turn.id}
                    turn={turn}
                    running={busy && turn.id === turns[turns.length - 1]?.id}
                    onResolve={decision => void resolveApproval(turn, decision)}
                  />
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="shrink-0 border-t border-border bg-bg-elevated p-3">
            {!baseUrl || !model ? (
              <button
                type="button"
                onClick={onOpenSettings}
                className="mb-2 flex w-full items-center gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-left text-xs text-warning"
              >
                <CircleAlert className="h-4 w-4 shrink-0" />
                配置模型后开始对话
              </button>
            ) : null}
            <div className="flex items-end gap-2 rounded-md border border-border bg-bg-base p-2 focus-within:border-accent">
              <AutoResizeTextarea
                minRows={1}
                maxRows={6}
                value={input}
                onChange={event => setInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void send()
                  }
                }}
                disabled={busy || hasPendingApproval}
                placeholder={pendingApproval ? '请先处理变更方案' : hasPendingApproval ? '请返回待审批对话' : '向 Agent 发出指令...'}
                className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm leading-5 text-text-primary outline-none placeholder:text-text-muted disabled:opacity-60"
              />
              <button
                type="button"
                onClick={busy ? () => void stop() : () => void send()}
                disabled={!busy && (!input.trim() || hasPendingApproval)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-accent text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-35"
                title={busy ? '停止' : '发送'}
                aria-label={busy ? '停止' : '发送'}
              >
                {busy ? <CircleStop className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  )
}

function ConversationToolbar({
  conversation,
  groups,
  busy,
  blocked,
  onShowHistory,
  onNew,
  onMove,
}: {
  conversation: AgentConversation
  groups: AgentConversationGroup[]
  busy: boolean
  blocked: boolean
  onShowHistory: () => void
  onNew: () => void
  onMove: (groupId: string) => void
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-bg-elevated px-3">
      <button
        type="button"
        onClick={onShowHistory}
        disabled={busy}
        className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
        title="对话历史"
        aria-label="对话历史"
      >
        <History className="h-3.5 w-3.5" />
      </button>
      <div className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">{conversation.title}</div>
      <select
        aria-label="对话分组"
        value={conversation.groupId}
        onChange={event => onMove(event.target.value)}
        disabled={busy}
        className="h-7 max-w-20 rounded border border-border bg-bg-base px-1.5 text-[10px] text-text-secondary outline-none focus:border-accent disabled:opacity-50"
      >
        {groups.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}
      </select>
      <button
        type="button"
        onClick={onNew}
        disabled={busy || blocked}
        className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-accent disabled:opacity-40"
        title="新建对话"
        aria-label="新建对话"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function ConversationHistory({
  groups,
  conversations,
  activeConversationId,
  busy,
  onBack,
  onSelect,
  onNew,
  onAddGroup,
  onRenameGroup,
  onDeleteGroup,
  onRenameConversation,
  onMoveConversation,
  onDeleteConversation,
}: {
  groups: AgentConversationGroup[]
  conversations: AgentConversation[]
  activeConversationId: string
  busy: boolean
  onBack: () => void
  onSelect: (conversationId: string) => void
  onNew: () => void
  onAddGroup: (label: string) => void
  onRenameGroup: (groupId: string, label: string) => void
  onDeleteGroup: (groupId: string) => void
  onRenameConversation: (conversationId: string, title: string) => void
  onMoveConversation: (conversationId: string, groupId: string) => void
  onDeleteConversation: (conversationId: string) => void
}) {
  const [newGroup, setNewGroup] = useState('')
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingGroupLabel, setEditingGroupLabel] = useState('')

  const submitGroup = () => {
    if (!newGroup.trim()) return
    onAddGroup(newGroup)
    setNewGroup('')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <button type="button" onClick={onBack} className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary" aria-label="返回对话">
          <ChevronRight className="h-4 w-4 rotate-180" />
        </button>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-primary">对话历史</span>
        <button
          type="button"
          onClick={onNew}
          disabled={busy || conversations.some(conversation => conversation.turns.some(turn => turn.waitingApproval))}
          className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-accent disabled:opacity-40"
          title="新建对话"
          aria-label="新建对话"
        >
          <MessageSquarePlus className="h-4 w-4" />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <FolderPlus className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        <input
          value={newGroup}
          onChange={event => setNewGroup(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) submitGroup()
          }}
          placeholder="新分组"
          maxLength={12}
          className="h-7 min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
        />
        <button
          type="button"
          onClick={submitGroup}
          disabled={!newGroup.trim()}
          className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-accent disabled:opacity-35"
          aria-label="添加分组"
          title="添加分组"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {[...groups].sort((left, right) => left.order - right.order).map(group => {
          const grouped = conversations
            .filter(conversation => conversation.groupId === group.id)
            .sort((left, right) => right.updatedAt - left.updatedAt)
          if (grouped.length === 0 && !group.custom) return null
          return (
            <section key={group.id} className="border-b border-border">
              <div className="flex h-8 items-center gap-2 bg-bg-elevated px-3">
                {editingGroupId === group.id ? (
                  <input
                    value={editingGroupLabel}
                    onChange={event => setEditingGroupLabel(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        onRenameGroup(group.id, editingGroupLabel)
                        setEditingGroupId(null)
                      }
                    }}
                    autoFocus
                    maxLength={12}
                    className="h-6 min-w-0 flex-1 border-b border-accent bg-transparent text-[11px] text-text-primary outline-none"
                  />
                ) : (
                  <div className="min-w-0 flex-1 truncate text-[10px] font-semibold text-text-muted">{group.label}</div>
                )}
                <span className="text-[10px] text-text-muted">{grouped.length}</span>
                {group.custom && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        if (editingGroupId === group.id) {
                          onRenameGroup(group.id, editingGroupLabel)
                          setEditingGroupId(null)
                        } else {
                          setEditingGroupId(group.id)
                          setEditingGroupLabel(group.label)
                        }
                      }}
                      className="rounded p-0.5 text-text-muted hover:text-accent"
                      aria-label={editingGroupId === group.id ? '保存分组名称' : '重命名分组'}
                      title={editingGroupId === group.id ? '保存' : '重命名'}
                    >
                      {editingGroupId === group.id ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteGroup(group.id)}
                      className="rounded p-0.5 text-text-muted hover:text-error"
                      aria-label="删除分组"
                      title="删除分组"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>

              <div className="divide-y divide-border">
                {grouped.map(conversation => {
                  const editing = editingConversationId === conversation.id
                  const waiting = conversation.turns.some(turn => turn.waitingApproval)
                  return (
                    <div key={conversation.id} className={`px-3 py-2.5 ${conversation.id === activeConversationId ? 'bg-accent/[0.08]' : 'hover:bg-bg-hover'}`}>
                      {editing ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <input
                              value={editingTitle}
                              onChange={event => setEditingTitle(event.target.value)}
                              maxLength={40}
                              autoFocus
                              className="h-7 min-w-0 flex-1 rounded border border-accent bg-bg-base px-2 text-xs text-text-primary outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                onRenameConversation(conversation.id, editingTitle)
                                setEditingConversationId(null)
                              }}
                              className="rounded p-1 text-success hover:bg-bg-hover"
                              aria-label="保存对话名称"
                              title="保存"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <select
                            value={conversation.groupId}
                            onChange={event => onMoveConversation(conversation.id, event.target.value)}
                            className="h-7 w-full rounded border border-border bg-bg-base px-2 text-[11px] text-text-secondary outline-none focus:border-accent"
                            aria-label="移动到分组"
                          >
                            {groups.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                          </select>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() => onSelect(conversation.id)}
                            disabled={busy}
                            className="min-w-0 flex-1 text-left disabled:opacity-50"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-medium text-text-primary">{conversation.title}</span>
                              {waiting && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title="待审批" />}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-text-muted">
                              <span>{conversation.turns.length} 轮</span>
                              <span>{formatConversationTime(conversation.updatedAt)}</span>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingConversationId(conversation.id)
                              setEditingTitle(conversation.title)
                            }}
                            className="rounded p-1 text-text-muted hover:bg-bg-elevated hover:text-accent"
                            aria-label="编辑对话"
                            title="编辑"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteConversation(conversation.id)}
                            disabled={waiting || busy}
                            className="rounded p-1 text-text-muted hover:bg-bg-elevated hover:text-error disabled:opacity-30"
                            aria-label="删除对话"
                            title="删除"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function formatConversationTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp)
  if (elapsed < 60_000) return '刚刚'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)} 天前`
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function EmptyConversation({ onUse }: { onUse: (value: string) => void }) {
  const prompts = ['梳理当前世界观设定', '检查角色与大纲是否冲突', '完善世界起源并生成变更方案']
  return (
    <div className="flex min-h-full flex-col justify-center py-8">
      <div className="mb-6 flex items-center gap-3 px-1">
        <Sparkles className="h-5 w-5 text-accent" />
        <div>
          <div className="text-sm font-medium text-text-primary">项目副驾</div>
          <div className="mt-0.5 text-xs text-text-muted">当前项目 · 注册表工具已就绪</div>
        </div>
      </div>
      <div className="border-y border-border">
        {prompts.map(prompt => (
          <button
            key={prompt}
            type="button"
            onClick={() => onUse(prompt)}
            className="group flex w-full items-center gap-2 border-b border-border px-1 py-3 text-left text-xs text-text-secondary last:border-b-0 hover:text-text-primary"
          >
            <ChevronRight className="h-3.5 w-3.5 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
            {prompt}
          </button>
        ))}
      </div>
    </div>
  )
}

function TurnView({
  turn,
  running,
  onResolve,
}: {
  turn: AgentConversationTurn
  running: boolean
  onResolve: (decision: 'approved' | 'rejected') => void
}) {
  const phases = collectPhaseViews(turn.events)

  return (
    <section className="space-y-3">
      <div className="ml-8 rounded-md bg-accent px-3 py-2.5 text-sm leading-5 text-white">
        {turn.userMessage}
      </div>

      {phases.length > 0 && <PhaseTimeline phases={phases} running={running} />}

      {turn.assistantMessage && (
        <div className="whitespace-pre-wrap px-1 text-sm leading-6 text-text-primary">
          {turn.assistantMessage}
        </div>
      )}

      {turn.waitingApproval && (
        <div className="border-l-2 border-warning bg-warning/10 px-3 py-3">
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-text-primary">变更方案待确认</div>
              <p className="mt-1 text-xs leading-5 text-text-secondary">{turn.waitingApproval.payload.summary}</p>
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onResolve('rejected')}
              disabled={running}
              className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover disabled:opacity-50"
            >
              拒绝
            </button>
            <button
              type="button"
              onClick={() => onResolve('approved')}
              disabled={running}
              className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              批准并写入
            </button>
          </div>
        </div>
      )}

      {turn.error && (
        <div className="flex items-start gap-2 border-l-2 border-error bg-error/10 px-3 py-2 text-xs leading-5 text-error">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {turn.error}
        </div>
      )}

      {running && !turn.assistantMessage && !turn.waitingApproval && (
        <div className="flex items-center gap-2 px-1 text-xs text-text-muted">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          Agent 正在执行
        </div>
      )}
    </section>
  )
}

interface ToolCallView {
  readonly toolCallId: string
  readonly name: string
  readonly summary: string
  readonly status: 'running' | 'completed' | 'failed'
  readonly result?: string
}

interface PhaseView {
  id: string
  label: string
  status: 'running' | 'completed' | 'failed'
  startedAt: number
  completedAt?: number
  reasoning: string
  output: string
  tools: ToolCallView[]
}

function PhaseTimeline({ phases, running }: { phases: PhaseView[]; running: boolean }) {
  return (
    <div className="space-y-2 border-l-2 border-accent/45 pl-3">
      <div className="text-[10px] font-semibold text-text-muted">执行过程</div>
      {phases.map((phase, index) => {
        const phaseOutput = phase.output.trim()
        const title = phase.tools[0]?.summary || phase.label
        const duration = Math.max(0, (phase.completedAt ?? Date.now()) - phase.startedAt)
        return (
          <details
            key={phase.id}
            className="group border-b border-border pb-2 last:border-b-0"
            open={phase.status === 'running' || index === phases.length - 1}
          >
            <summary className="flex cursor-pointer list-none items-center gap-1.5 py-0.5 text-[11px] text-text-secondary hover:text-text-primary">
              <ChevronDown className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" />
              <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
              <span className="shrink-0 text-[10px] text-text-muted">{formatDuration(duration, phase.status === 'running' && running)}</span>
              {phase.status === 'running' ? (
                <LoaderCircle className="h-3 w-3 shrink-0 animate-spin text-accent" />
              ) : phase.status === 'failed' ? (
                <XCircle className="h-3 w-3 shrink-0 text-error" />
              ) : (
                <Check className="h-3 w-3 shrink-0 text-success" />
              )}
            </summary>
            <div className="mt-2 space-y-2 pl-4">
              {phase.reasoning.trim() && (
                <p className="whitespace-pre-wrap text-xs leading-5 text-text-secondary">{phase.reasoning.trim()}</p>
              )}
              {phase.tools.map(call => <ToolCallRow key={call.toolCallId} call={call} />)}
              {phaseOutput && (
                <div className="whitespace-pre-wrap border-l-2 border-border pl-2 text-xs leading-5 text-text-primary">
                  {phaseOutput}
                </div>
              )}
            </div>
          </details>
        )
      })}
    </div>
  )
}

function formatDuration(durationMs: number, active: boolean): string {
  if (active && durationMs < 1000) return '进行中'
  if (durationMs < 1000) return '<1秒'
  return `${Math.max(1, Math.round(durationMs / 1000))}秒`
}

function ToolCallRow({ call }: { call: ToolCallView }) {
  const Icon = call.status === 'completed' ? Check : call.status === 'failed' ? XCircle : LoaderCircle
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-bg-elevated text-text-muted">
        <Wrench className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="break-words text-text-secondary">{call.summary || call.name}</div>
        {call.result && <div className="mt-0.5 whitespace-pre-wrap break-words text-text-muted">{call.result}</div>}
      </div>
      <Icon className={`mt-1 h-3 w-3 shrink-0 ${call.status === 'running' ? 'animate-spin text-text-muted' : call.status === 'failed' ? 'text-error' : 'text-success'}`} />
    </div>
  )
}

function McpConnections({
  servers,
  statuses,
  onChange,
  onTest,
  onBack,
}: {
  servers: McpServerConfig[]
  statuses: Record<string, string>
  onChange: (servers: McpServerConfig[]) => void
  onTest: (server: McpServerConfig) => void
  onBack: () => void
}) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [transport, setTransport] = useState<'streamable-http' | 'sse'>('streamable-http')

  const add = () => {
    if (!url.trim()) return
    onChange([...servers, createMcpServerConfig({ name, url, transport })])
    setName('')
    setUrl('')
  }

  const patchServer = (id: string, patch: Partial<McpServerConfig>) => {
    onChange(servers.map(server => server.id === id ? { ...server, ...patch } : server))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <button type="button" onClick={onBack} className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary" aria-label="返回对话">
          <ChevronRight className="h-4 w-4 rotate-180" />
        </button>
        <span className="text-xs font-semibold text-text-primary">MCP 连接</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="space-y-2 border-b border-border pb-4">
          <input
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="连接名称"
            className="w-full rounded border border-border bg-bg-base px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent"
          />
          <input
            value={url}
            onChange={event => setUrl(event.target.value)}
            placeholder="https://example.com/mcp"
            className="w-full rounded border border-border bg-bg-base px-2.5 py-2 font-mono text-xs text-text-primary outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2">
            <div className="flex flex-1 rounded border border-border bg-bg-base p-0.5">
              {(['streamable-http', 'sse'] as const).map(value => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTransport(value)}
                  className={`flex-1 rounded-sm px-2 py-1 text-[10px] ${transport === value ? 'bg-accent text-white' : 'text-text-muted hover:text-text-secondary'}`}
                >
                  {value === 'streamable-http' ? 'HTTP' : 'SSE'}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={add}
              disabled={!url.trim()}
              className="flex h-7 w-7 items-center justify-center rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-35"
              aria-label="添加 MCP 连接"
              title="添加连接"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="divide-y divide-border">
          {servers.map(server => (
            <div key={server.id} className="py-3">
              <div className="flex items-start gap-2">
                <label className="mt-0.5 flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    onChange={event => patchServer(server.id, { enabled: event.target.checked })}
                    className="accent-[var(--accent)]"
                  />
                </label>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-text-primary">{server.name}</div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-text-muted">{server.url}</div>
                </div>
                <button type="button" onClick={() => void onTest(server)} className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-accent" title="测试连接" aria-label="测试连接">
                  <Plug className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => onChange(servers.filter(item => item.id !== server.id))} className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-error" title="删除连接" aria-label="删除连接">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <label className="mt-2 flex cursor-pointer items-center gap-2 pl-6 text-[10px] text-text-muted">
                <input
                  type="checkbox"
                  checked={server.allowWrite}
                  onChange={event => patchServer(server.id, { allowWrite: event.target.checked })}
                  className="accent-[var(--accent)]"
                />
                允许外部写入工具
              </label>
              {statuses[server.id] && (
                <div className="mt-2 pl-6 text-[10px] text-text-muted">{statuses[server.id]}</div>
              )}
            </div>
          ))}
          {servers.length === 0 && (
            <div className="py-8 text-center text-xs text-text-muted">暂无 MCP 连接</div>
          )}
        </div>
      </div>
    </div>
  )
}

function createResources(
  projectId: number,
  configRef: React.MutableRefObject<McpServerConfig[]>,
  setMcpStatus: React.Dispatch<React.SetStateAction<Record<string, string>>>,
): AgentResources {
  const storage = new DexieProjectStorage({ backend: 'dexie', projectId })
  const plans = new AdoptionPlanStore()
  const mcp = new McpToolProvider()
  const runtime = new AiSdkAgentRuntimeAdapter({
    platform: isTauri() ? 'desktop' : 'web',
    getModelConfig: () => {
      const config = useAIConfigStore.getState().config
      return {
        provider: config.provider,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      }
    },
    grantedScopes: () => [
      'project:read',
      'external:read',
      ...(configRef.current.some(server => server.enabled && server.allowWrite) ? ['external:write' as const] : []),
    ],
    createToolRegistry: async () => {
      const registry = new ToolRegistry()
      for (const tool of createStoryForgeTools({ storage, plans })) registry.register(tool)
      const external = await mcp.load(configRef.current)
      for (const tool of external.tools) registry.register(tool)
      if (external.errors.length) {
        setMcpStatus(current => ({
          ...current,
          ...Object.fromEntries(external.errors.map(error => [error.serverId, error.message])),
        }))
      }
      return registry
    },
  })
  return { runtime, mcp, storage }
}

function reduceTurn(turn: AgentConversationTurn, event: AgentEvent): AgentConversationTurn {
  const next = { ...turn, runId: event.runId, events: [...turn.events, event] }
  if (event.type === 'message.delta') next.assistantMessage += event.payload.text
  if (event.type === 'message.completed' && !next.assistantMessage.endsWith(event.payload.text)) {
    next.assistantMessage += `${next.assistantMessage ? '\n\n' : ''}${event.payload.text}`
  }
  if (event.type === 'approval.requested') next.waitingApproval = event
  if (event.type === 'approval.resolved') next.waitingApproval = undefined
  if (event.type === 'run.failed') next.error = event.payload.error
  if (event.type === 'run.cancelled') next.error = event.payload.reason || '任务已停止'
  return next
}

function collectPhaseViews(events: readonly AgentEvent[]): PhaseView[] {
  const phases: PhaseView[] = []
  let current: PhaseView | undefined

  const ensurePhase = (event: AgentEvent): PhaseView => {
    if (current) return current
    current = {
      id: `implicit-${event.runId}-${phases.length + 1}`,
      label: `阶段 ${phases.length + 1}`,
      status: 'running',
      startedAt: event.timestamp,
      reasoning: '',
      output: '',
      tools: [],
    }
    phases.push(current)
    return current
  }

  for (const event of events) {
    if (event.type === 'phase.started') {
      current = {
        id: `${event.runId}-${event.payload.phase}-${event.sequence}`,
        label: event.payload.label,
        status: 'running',
        startedAt: event.timestamp,
        reasoning: '',
        output: '',
        tools: [],
      }
      phases.push(current)
    } else if (event.type === 'phase.completed') {
      const phase = current ?? ensurePhase(event)
      phase.status = 'completed'
      phase.completedAt = event.timestamp
      if (event.payload.summary && !phase.output.includes(event.payload.summary)) {
        phase.output += `${phase.output ? '\n' : ''}${event.payload.summary}`
      }
    } else if (event.type === 'reasoning.summary.delta') {
      ensurePhase(event).reasoning += event.payload.text
    } else if (event.type === 'tool.requested') {
      ensurePhase(event).tools.push({
        toolCallId: event.payload.toolCallId,
        name: event.payload.toolName,
        summary: event.payload.summary,
        status: 'running',
      })
    } else if (event.type === 'tool.completed') {
      const phase = phases.find(item => item.tools.some(tool => tool.toolCallId === event.payload.toolCallId))
        ?? ensurePhase(event)
      const callIndex = phase.tools.findIndex(tool => tool.toolCallId === event.payload.toolCallId)
      const call = callIndex >= 0 ? phase.tools[callIndex] : undefined
      const completed: ToolCallView = {
        toolCallId: event.payload.toolCallId,
        name: event.payload.toolName,
        summary: call?.summary || event.payload.toolName,
        status: 'completed',
        result: event.payload.summary,
      }
      if (callIndex >= 0) phase.tools[callIndex] = completed
      else phase.tools.push(completed)
    } else if (event.type === 'tool.failed') {
      const phase = phases.find(item => item.tools.some(tool => tool.toolCallId === event.payload.toolCallId))
        ?? ensurePhase(event)
      const callIndex = phase.tools.findIndex(tool => tool.toolCallId === event.payload.toolCallId)
      const call = callIndex >= 0 ? phase.tools[callIndex] : undefined
      const failed: ToolCallView = {
        toolCallId: event.payload.toolCallId,
        name: event.payload.toolName,
        summary: call?.summary || event.payload.toolName,
        status: 'failed',
        result: event.payload.error,
      }
      if (callIndex >= 0) phase.tools[callIndex] = failed
      else phase.tools.push(failed)
      phase.status = 'failed'
      phase.completedAt = event.timestamp
    } else if (event.type === 'message.delta') {
      ensurePhase(event).output += event.payload.text
    } else if (event.type === 'message.completed') {
      const phase = ensurePhase(event)
      if (!phase.output.endsWith(event.payload.text)) {
        phase.output += `${phase.output ? '\n\n' : ''}${event.payload.text}`
      }
    } else if (event.type === 'run.failed' || event.type === 'run.cancelled') {
      const phase = ensurePhase(event)
      phase.status = 'failed'
      phase.completedAt = event.timestamp
    } else if (event.type === 'run.completed' && current?.status === 'running') {
      current.status = 'completed'
      current.completedAt = event.timestamp
    }
  }
  return phases
}

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window
}

function ensureConversationState(
  state: AgentConversationState,
  projectId: number,
  module: string,
): AgentConversationState {
  const current = state.projectId === projectId ? state : createAgentConversationState(projectId)
  if (current.conversations.length > 0) return current
  return {
    ...current,
    conversations: [createAgentConversation({
      id: `project-${projectId}-${nanoid(8)}`,
      projectId,
      module,
    })],
  }
}
