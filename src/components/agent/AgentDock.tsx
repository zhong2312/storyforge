import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleStop,
  LoaderCircle,
  PanelRight,
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

interface ConversationTurn {
  readonly id: string
  readonly userMessage: string
  runId?: string
  assistantMessage: string
  events: AgentEvent[]
  waitingApproval?: Extract<AgentEvent, { type: 'approval.requested' }>
  error?: string
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
  const [turns, setTurns] = useState<ConversationTurn[]>([])
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'chat' | 'connections'>('chat')
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>(loadMcpServerConfigs)
  const [mcpStatus, setMcpStatus] = useState<Record<string, string>>({})
  const configRef = useRef(mcpServers)
  const resources = useMemo<AgentResources>(() => createResources(projectId, configRef, setMcpStatus), [projectId])
  const conversationId = useMemo(() => `project-${projectId}-${nanoid(8)}`, [projectId])
  const currentRunIdRef = useRef<string | null>(null)
  const handledIntentIdsRef = useRef(new Set<string>())
  const runContextRef = useRef(new Map<string, { scope: AgentScope; intentType?: string }>())
  const bottomRef = useRef<HTMLDivElement>(null)
  const pendingApproval = turns.find(turn => turn.waitingApproval)?.waitingApproval

  useEffect(() => {
    configRef.current = mcpServers
    saveMcpServerConfigs(mcpServers)
  }, [mcpServers])

  useEffect(() => {
    setTurns([])
    currentRunIdRef.current = null
    handledIntentIdsRef.current.clear()
    runContextRef.current.clear()
  }, [projectId])

  useEffect(() => () => {
    void resources.runtime.cancel(currentRunIdRef.current ?? '')
    void resources.mcp.close()
    void resources.storage.close()
  }, [resources])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, busy])

  const consumeEvents = useCallback(async (turnId: string, stream: AsyncIterable<AgentEvent>) => {
    for await (const event of stream) {
      currentRunIdRef.current = event.runId
      setTurns(current => current.map(turn => turn.id === turnId
        ? reduceTurn(turn, event)
        : turn))
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
  }, [onProjectChanged, projectId])

  const runMessage = useCallback(async (
    rawMessage: string,
    scope: AgentScope,
    displayMessage = rawMessage,
    intentType?: string,
  ) => {
    const message = rawMessage.trim()
    if (!message || busy || pendingApproval) return
    const turnId = nanoid()
    setInput('')
    setBusy(true)
    runContextRef.current.set(turnId, { scope, intentType })
    setTurns(current => [...current, {
      id: turnId,
      userMessage: displayMessage,
      assistantMessage: '',
      events: [],
    }])

    try {
      const stream = resources.runtime.run({
        conversationId,
        project: { backend: 'dexie', projectId },
        scope,
        userMessage: message,
      })
      await consumeEvents(turnId, stream)
    } finally {
      setBusy(false)
      currentRunIdRef.current = null
    }
  }, [busy, consumeEvents, conversationId, pendingApproval, projectId, resources.runtime])

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
    )
  }, [busy, intent, onIntentConsumed, pendingApproval, runMessage])

  const resolveApproval = async (turn: ConversationTurn, decision: 'approved' | 'rejected') => {
    if (!turn.runId || !turn.waitingApproval || busy) return
    setBusy(true)
    try {
      await consumeEvents(turn.id, resources.runtime.resume(turn.runId, {
        approvalId: turn.waitingApproval.payload.approvalId,
        decision,
      }))
    } finally {
      if (decision === 'rejected') runContextRef.current.delete(turn.id)
      setBusy(false)
      currentRunIdRef.current = null
    }
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
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-3 py-4">
            {turns.length === 0 ? (
              <EmptyConversation onUse={setInput} />
            ) : (
              <div className="space-y-5">
                {turns.map(turn => (
                  <TurnView
                    key={turn.id}
                    turn={turn}
                    busy={busy}
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
                disabled={busy || Boolean(pendingApproval)}
                placeholder={pendingApproval ? '请先处理变更方案' : '向 Agent 发出指令...'}
                className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm leading-5 text-text-primary outline-none placeholder:text-text-muted disabled:opacity-60"
              />
              <button
                type="button"
                onClick={busy ? () => void stop() : () => void send()}
                disabled={!busy && (!input.trim() || Boolean(pendingApproval))}
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
  busy,
  onResolve,
}: {
  turn: ConversationTurn
  busy: boolean
  onResolve: (decision: 'approved' | 'rejected') => void
}) {
  const reasoning = turn.events
    .filter((event): event is Extract<AgentEvent, { type: 'reasoning.summary.delta' }> => event.type === 'reasoning.summary.delta')
    .map(event => event.payload.text)
    .join('')
  const toolCalls = collectToolCalls(turn.events)
  const phases = turn.events.filter(event => event.type === 'phase.started') as Array<Extract<AgentEvent, { type: 'phase.started' }>>

  return (
    <section className="space-y-3">
      <div className="ml-8 rounded-md bg-accent px-3 py-2.5 text-sm leading-5 text-white">
        {turn.userMessage}
      </div>

      {(reasoning || phases.length > 0 || toolCalls.length > 0) && (
        <details className="group border-l-2 border-accent/45 pl-3" open={busy && !turn.waitingApproval}>
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-text-muted hover:text-text-secondary">
            <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
            执行过程
          </summary>
          <div className="mt-2 space-y-2">
            {reasoning && <p className="text-xs leading-5 text-text-secondary">{reasoning}</p>}
            {toolCalls.map(call => <ToolCallRow key={call.toolCallId} call={call} />)}
          </div>
        </details>
      )}

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
              disabled={busy}
              className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover disabled:opacity-50"
            >
              拒绝
            </button>
            <button
              type="button"
              onClick={() => onResolve('approved')}
              disabled={busy}
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

      {busy && !turn.assistantMessage && !turn.waitingApproval && (
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

function ToolCallRow({ call }: { call: ToolCallView }) {
  const Icon = call.status === 'completed' ? Check : call.status === 'failed' ? XCircle : LoaderCircle
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-bg-elevated text-text-muted">
        <Wrench className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-text-secondary">{call.summary || call.name}</div>
        {call.result && <div className="mt-0.5 truncate text-text-muted">{call.result}</div>}
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

function reduceTurn(turn: ConversationTurn, event: AgentEvent): ConversationTurn {
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

function collectToolCalls(events: readonly AgentEvent[]): ToolCallView[] {
  const calls = new Map<string, ToolCallView>()
  for (const event of events) {
    if (event.type === 'tool.requested') {
      calls.set(event.payload.toolCallId, {
        toolCallId: event.payload.toolCallId,
        name: event.payload.toolName,
        summary: event.payload.summary,
        status: 'running',
      })
    } else if (event.type === 'tool.completed') {
      const current = calls.get(event.payload.toolCallId)
      calls.set(event.payload.toolCallId, {
        toolCallId: event.payload.toolCallId,
        name: event.payload.toolName,
        summary: current?.summary || event.payload.toolName,
        status: 'completed',
        result: event.payload.summary,
      })
    } else if (event.type === 'tool.failed') {
      const current = calls.get(event.payload.toolCallId)
      calls.set(event.payload.toolCallId, {
        toolCallId: event.payload.toolCallId,
        name: event.payload.toolName,
        summary: current?.summary || event.payload.toolName,
        status: 'failed',
        result: event.payload.error,
      })
    }
  }
  return [...calls.values()]
}

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window
}
