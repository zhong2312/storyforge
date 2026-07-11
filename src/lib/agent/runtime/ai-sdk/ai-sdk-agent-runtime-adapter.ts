import { nanoid } from 'nanoid'
import { InMemoryAgentEventLog } from '../../events/in-memory-agent-event-log'
import type { AgentEvent, NewAgentEvent } from '../../events/agent-events'
import type {
  AgentRunInput,
  AgentRuntimePort,
  ApprovalDecision,
} from '../agent-runtime-port'
import type { ToolRegistry } from '../../tools/tool-registry'
import type {
  ApprovalReference,
  ToolDescriptor,
  ToolExecutionContext,
  ToolScope,
} from '../../tools/tool-types'
import {
  streamAiSdkAgentLoop,
  type AgentLoopPart,
  type AgentLoopStreamer,
  type AgentModelConfig,
} from './agent-loop'

const DEFAULT_MAX_STEPS = 8
const MAX_STEPS = 20
const DEFAULT_TOKEN_BUDGET = 12_000
const MAX_TOKEN_BUDGET = 64_000
const PROPOSE_TOOL = 'storyforge.change.propose'
const COMMIT_TOOL = 'storyforge.change.commit'

interface PendingApproval {
  readonly input: AgentRunInput
  readonly registry: ToolRegistry
  readonly approval: ApprovalReference
  readonly approvalId: string
  readonly planId: string
  readonly summary: string
}

interface ActiveRun {
  readonly input: AgentRunInput
  readonly controller: AbortController
}

export interface AiSdkAgentRuntimeDependencies {
  readonly getModelConfig: (profile?: string) => AgentModelConfig
  readonly createToolRegistry: (input: AgentRunInput) => ToolRegistry | Promise<ToolRegistry>
  readonly platform: 'web' | 'desktop'
  readonly grantedScopes?: readonly ToolScope[] | (() => readonly ToolScope[])
  readonly streamer?: AgentLoopStreamer
  readonly eventLog?: InMemoryAgentEventLog
}

export class AiSdkAgentRuntimeAdapter implements AgentRuntimePort {
  readonly #active = new Map<string, ActiveRun>()
  readonly #pending = new Map<string, PendingApproval>()
  readonly #log: InMemoryAgentEventLog
  readonly #streamer: AgentLoopStreamer

  constructor(private readonly dependencies: AiSdkAgentRuntimeDependencies) {
    this.#log = dependencies.eventLog ?? new InMemoryAgentEventLog()
    this.#streamer = dependencies.streamer ?? streamAiSdkAgentLoop
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    const runId = nanoid()
    const controller = new AbortController()
    this.#active.set(runId, { input, controller })
    let message = ''
    let reasoning = ''
    let proposal: PendingApproval | undefined

    yield this.append(runId, input.conversationId, 'run.started', { userMessage: input.userMessage })
    yield this.append(runId, input.conversationId, 'phase.started', {
      phase: 'prepare',
      label: '准备项目工具',
    })

    try {
      const registry = await this.dependencies.createToolRegistry(input)
      const context = this.createContext(runId, input, controller.signal)
      const descriptors = registry.listAvailable(context)
      yield this.append(runId, input.conversationId, 'phase.completed', {
        phase: 'prepare',
        summary: `已加载 ${descriptors.length} 个工具`,
      })

      const parts = this.#streamer({
        config: this.dependencies.getModelConfig(input.modelProfile),
        instructions: buildInstructions(descriptors, input),
        prompt: input.userMessage,
        descriptors,
        maxSteps: clampInteger(input.maxSteps, DEFAULT_MAX_STEPS, 1, MAX_STEPS),
        tokenBudget: clampInteger(input.tokenBudget, DEFAULT_TOKEN_BUDGET, 256, MAX_TOKEN_BUDGET),
        signal: controller.signal,
        execute: async (toolName, toolInput) => {
          const output = await registry.execute(toolName, context, toolInput)
          if (toolName === PROPOSE_TOOL) {
            proposal = createPendingApproval(input, registry, output)
          }
          return output
        },
        shouldStop: () => proposal !== undefined,
      })

      for await (const part of parts) {
        for (const event of this.eventsFromPart(runId, input.conversationId, part, registry)) {
          if (event.type === 'message.delta') message += event.payload.text
          if (event.type === 'reasoning.summary.delta') reasoning += event.payload.text
          yield event
        }
      }

      if (reasoning) {
        yield this.append(runId, input.conversationId, 'reasoning.summary.completed', { text: reasoning })
      }
      if (message) {
        yield this.append(runId, input.conversationId, 'message.completed', { text: message })
      }
      if (proposal) {
        this.#pending.set(runId, proposal)
        yield this.append(runId, input.conversationId, 'approval.requested', {
          approvalId: proposal.approvalId,
          planId: proposal.planId,
          summary: proposal.summary,
        })
        return
      }

      yield this.append(runId, input.conversationId, 'run.completed', {
        summary: message || 'Agent 已完成任务',
      })
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        yield this.append(runId, input.conversationId, 'run.cancelled', { reason: '用户已停止' })
      } else {
        yield this.append(runId, input.conversationId, 'run.failed', { error: errorMessage(error) })
      }
    } finally {
      this.#active.delete(runId)
    }
  }

  async *resume(runId: string, decision?: ApprovalDecision): AsyncIterable<AgentEvent> {
    const pending = this.#pending.get(runId)
    if (!pending) throw new Error(`[agent-runtime] run is not awaiting approval: ${runId}`)
    if (!decision || decision.approvalId !== pending.approvalId) {
      throw new Error('[agent-runtime] matching approval decision is required')
    }
    this.#pending.delete(runId)
    const { input } = pending
    yield this.append(runId, input.conversationId, 'approval.resolved', {
      approvalId: decision.approvalId,
      decision: decision.decision,
    })

    if (decision.decision !== 'approved') {
      const text = decision.decision === 'edited'
        ? '已取消原方案。请在新消息中说明调整内容，我会重新生成变更方案。'
        : '已取消本次变更，项目数据未修改。'
      yield this.append(runId, input.conversationId, 'message.completed', { text })
      yield this.append(runId, input.conversationId, 'run.completed', { summary: text })
      return
    }

    const controller = new AbortController()
    this.#active.set(runId, { input, controller })
    const context = this.createContext(runId, input, controller.signal, pending.approval, ['project:write'])
    const toolCallId = nanoid()
    yield this.append(runId, input.conversationId, 'phase.started', {
      phase: 'commit',
      label: '提交已批准变更',
    })
    yield this.append(runId, input.conversationId, 'tool.requested', {
      toolCallId,
      toolName: COMMIT_TOOL,
      summary: `提交变更计划 ${pending.planId}`,
    })
    yield this.append(runId, input.conversationId, 'tool.started', { toolCallId, toolName: COMMIT_TOOL })

    try {
      const output = await pending.registry.execute(COMMIT_TOOL, context, { planId: pending.planId })
      const descriptor = pending.registry.get(COMMIT_TOOL)
      yield this.append(runId, input.conversationId, 'tool.completed', {
        toolCallId,
        toolName: COMMIT_TOOL,
        summary: summarizeOutput(descriptor, output),
      })
      yield this.append(runId, input.conversationId, 'phase.completed', {
        phase: 'commit',
        summary: pending.summary,
      })
      const text = '已按批准方案更新项目设定。'
      yield this.append(runId, input.conversationId, 'message.completed', { text })
      yield this.append(runId, input.conversationId, 'run.completed', { summary: text })
    } catch (error) {
      yield this.append(runId, input.conversationId, 'tool.failed', {
        toolCallId,
        toolName: COMMIT_TOOL,
        error: errorMessage(error),
      })
      yield this.append(runId, input.conversationId, 'run.failed', { error: errorMessage(error) })
    } finally {
      this.#active.delete(runId)
    }
  }

  async cancel(runId: string): Promise<void> {
    this.#active.get(runId)?.controller.abort()
  }

  private *eventsFromPart(
    runId: string,
    conversationId: string,
    part: AgentLoopPart,
    registry: ToolRegistry,
  ): Iterable<AgentEvent> {
    switch (part.type) {
      case 'phase-start':
        yield this.append(runId, conversationId, 'phase.started', {
          phase: `step-${part.step}`,
          label: `Agent 步骤 ${part.step}`,
        })
        break
      case 'phase-end':
        yield this.append(runId, conversationId, 'phase.completed', { phase: `step-${part.step}` })
        break
      case 'text':
        yield this.append(runId, conversationId, 'message.delta', { text: part.text })
        break
      case 'reasoning':
        yield this.append(runId, conversationId, 'reasoning.summary.delta', { text: part.text })
        break
      case 'tool-call': {
        const descriptor = registry.get(part.toolName)
        yield this.append(runId, conversationId, 'tool.requested', {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          summary: summarizeInput(descriptor, part.input),
        })
        yield this.append(runId, conversationId, 'tool.started', {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
        })
        break
      }
      case 'tool-result':
        yield this.append(runId, conversationId, 'tool.completed', {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          summary: summarizeOutput(registry.get(part.toolName), part.output),
        })
        break
      case 'tool-error':
        yield this.append(runId, conversationId, 'tool.failed', {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          error: errorMessage(part.error),
        })
        break
      case 'abort':
        throw new DOMException(part.reason || 'Agent run aborted', 'AbortError')
      case 'error':
        throw part.error
    }
  }

  private createContext(
    runId: string,
    input: AgentRunInput,
    signal: AbortSignal,
    approval?: ApprovalReference,
    extraScopes: readonly ToolScope[] = [],
  ): ToolExecutionContext {
    const granted = typeof this.dependencies.grantedScopes === 'function'
      ? this.dependencies.grantedScopes()
      : this.dependencies.grantedScopes ?? ['project:read']
    return {
      runId,
      conversationId: input.conversationId,
      sessionId: input.conversationId,
      project: input.project,
      platform: this.dependencies.platform,
      scopes: new Set([...granted, ...extraScopes]),
      signal,
      actor: { id: 'workspace-user', kind: 'user' },
      worldGroupId: input.scope.worldGroupId,
      outlineNodeId: input.scope.outlineNodeId,
      chapterId: input.scope.chapterId,
      approval,
    }
  }

  private append<Type extends NewAgentEvent['type']>(
    runId: string,
    conversationId: string,
    type: Type,
    payload: Extract<NewAgentEvent, { type: Type }>['payload'],
  ): AgentEvent {
    return this.#log.append({ runId, conversationId, type, payload } as NewAgentEvent)
  }
}

function createPendingApproval(
  input: AgentRunInput,
  registry: ToolRegistry,
  output: unknown,
): PendingApproval {
  const record = asRecord(output)
  const planId = stringField(record, 'planId')
  const approvalId = stringField(record, 'approvalId')
  const planHash = stringField(record, 'planHash')
  if (!planId || !approvalId || !planHash) {
    throw new Error('[agent-runtime] change proposal did not return approval metadata')
  }
  return {
    input,
    registry,
    planId,
    approvalId,
    approval: { approvalId, planHash },
    summary: proposalSummary(record),
  }
}

function proposalSummary(output: Record<string, unknown>): string {
  const preview = asRecord(output.preview)
  const target = stringField(preview, 'target') || '项目设定'
  const itemCount = typeof preview.itemCount === 'number' ? preview.itemCount : 1
  const fields = Array.isArray(preview.canonicalFields)
    ? preview.canonicalFields.filter(value => typeof value === 'string').join('、')
    : ''
  return `修改 ${target}（${itemCount} 项${fields ? `：${fields}` : ''}）`
}

function buildInstructions(descriptors: readonly ToolDescriptor[], input: AgentRunInput): string {
  return [
    '你是 StoryForge 项目副驾。优先使用工具获取事实，不得猜测项目设定。',
    '读取设定前先用 storyforge.settings.catalog 了解可用源，再用 storyforge.context.read 获取需要的上下文。',
    '任何修改必须调用 storyforge.change.propose 生成方案；提案后立即停止并等待用户批准，不得声称已经写入。',
    '回答使用中文，清楚说明已读取的事实、当前阶段和下一步。只输出简短的阶段性推理摘要。',
    `当前界面模块：${input.scope.module || '未知'}。`,
    `可用工具：${descriptors.map(tool => tool.name).join(', ') || '无'}。`,
  ].join('\n')
}

function summarizeInput(descriptor: ToolDescriptor | undefined, input: unknown): string {
  try {
    return descriptor?.summarizeInput?.(input) ?? descriptor?.title ?? '调用工具'
  } catch {
    return descriptor?.title ?? '调用工具'
  }
}

function summarizeOutput(descriptor: ToolDescriptor | undefined, output: unknown): string {
  try {
    return descriptor?.summarizeOutput?.(output) ?? `${descriptor?.title ?? '工具'}已完成`
  } catch {
    return `${descriptor?.title ?? '工具'}已完成`
  }
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value as number)))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
