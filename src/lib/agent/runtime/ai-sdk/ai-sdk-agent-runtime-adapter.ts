import { nanoid } from 'nanoid'
import { InMemoryAgentEventLog } from '../../events/in-memory-agent-event-log'
import type {
  AgentChangePreview,
  AgentEvent,
  NewAgentEvent,
} from '../../events/agent-events'
import type {
  AgentChangeProposalCompletionRequirement,
  AgentCompletionRequirement,
  AgentPromptProfile,
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
const DEFAULT_REQUIRED_MAX_STEPS = 16
const REQUIRED_COMPLETION_STEP_RESERVE = 8
const MAX_STEPS = 48
const MAX_TOKEN_BUDGET = 64_000
const CONTEXT_READ_TOOL = 'storyforge.context.read'
const PROPOSE_TOOL = 'storyforge.change.propose'
const COMMIT_TOOL = 'storyforge.change.commit'

interface PendingApproval {
  readonly input: AgentRunInput
  readonly registry: ToolRegistry
  readonly approval: ApprovalReference
  readonly approvalId: string
  readonly planId: string
  readonly summary: string
  readonly preview?: AgentChangePreview
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
  readonly discardPlan?: (planId: string) => void
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
    let lastCompletionError = ''
    const readContextSources = new Set<string>()
    const passedPreProposalTools = new Set<string>()

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
        summary: input.promptProfile
          ? `${toolPreparationSummary(descriptors)}；已加载提示词“${input.promptProfile.name}”`
          : toolPreparationSummary(descriptors),
      })

      const parts = this.#streamer({
        config: applyPromptModelOverride(
          this.dependencies.getModelConfig(input.modelProfile),
          input.promptProfile,
        ),
        instructions: buildInstructions(descriptors, input),
        prompt: input.userMessage,
        conversationHistory: input.conversationHistory,
        descriptors,
        maxSteps: clampInteger(
          input.maxSteps,
          defaultMaxSteps(input.completionRequirement),
          1,
          MAX_STEPS,
        ),
        tokenBudget: input.tokenBudget == null
          ? undefined
          : clampInteger(input.tokenBudget, input.tokenBudget, 256, MAX_TOKEN_BUDGET),
        signal: controller.signal,
        execute: async (toolName, toolInput) => {
          if (toolName === PROPOSE_TOOL && input.completionRequirement) {
            try {
              assertCompletionProposalInput(input.completionRequirement, toolInput, readContextSources)
              assertPreProposalToolsPassed(input.completionRequirement, passedPreProposalTools)
            } catch (error) {
              lastCompletionError = errorMessage(error)
              throw error
            }
          }
          const output = await registry.execute(toolName, context, toolInput)
          if (toolName === CONTEXT_READ_TOOL) {
            for (const source of acknowledgedContextSources(toolInput, output)) {
              readContextSources.add(source)
            }
          }
          if (input.completionRequirement?.requiredPreProposalTools?.includes(toolName)
            && asRecord(output).canPropose === true) {
            passedPreProposalTools.add(toolName)
          }
          if (toolName === PROPOSE_TOOL) {
            proposal = createPendingApproval(input, registry, output, toolInput)
          }
          return output
        },
        shouldStop: () => proposal !== undefined,
        requiredContextTool: input.completionRequirement?.requiredContextSources?.length
          ? CONTEXT_READ_TOOL
          : undefined,
        requiredCompletionTool: input.completionRequirement ? PROPOSE_TOOL : undefined,
        requiredCompletionReminder: input.completionRequirement
          ? completionRequirementReminder(input.completionRequirement)
          : undefined,
        shouldForceCompletion: () => requiredContextIsReady(
          input.completionRequirement,
          readContextSources,
        ),
        remainingContextSources: () => input.completionRequirement
          ? missingRequiredSources(input.completionRequirement, readContextSources)
          : [],
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
      if (input.completionRequirement && !proposal) {
        throw new Error(completionFailureMessage(
          input.completionRequirement,
          readContextSources,
          lastCompletionError,
        ))
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
          preview: proposal.preview,
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
    const { input } = pending
    yield this.append(runId, input.conversationId, 'approval.resolved', {
      approvalId: decision.approvalId,
      decision: decision.decision,
    })

    if (decision.decision !== 'approved') {
      this.#pending.delete(runId)
      this.dependencies.discardPlan?.(pending.planId)
      const text = decision.decision === 'edited'
        ? '上一版候选已作废，项目数据未修改。正在按你的调整要求重新生成。'
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
        output,
      })
      yield this.append(runId, input.conversationId, 'phase.completed', {
        phase: 'commit',
        summary: pending.summary,
      })
      const text = pending.preview?.target === 'chapters'
        ? '已采纳最终版本并写入当前章节。'
        : '已采纳最终方案并更新项目。'
      this.#pending.delete(runId)
      yield this.append(runId, input.conversationId, 'message.completed', { text })
      yield this.append(runId, input.conversationId, 'run.completed', { summary: text })
    } catch (error) {
      yield this.append(runId, input.conversationId, 'tool.failed', {
        toolCallId,
        toolName: COMMIT_TOOL,
        error: errorMessage(error),
      })
      const retry = { ...pending, approvalId: nanoid() }
      this.#pending.set(runId, retry)
      yield this.append(runId, input.conversationId, 'approval.requested', {
        approvalId: retry.approvalId,
        planId: retry.planId,
        summary: `写入失败：${errorMessage(error)}。可重试采纳、调整或放弃。`,
        preview: retry.preview,
      })
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
          output: part.output,
        })
        break
      case 'history-compression-start':
        yield this.append(runId, conversationId, 'phase.started', {
          phase: 'compress-history',
          label: `压缩历史上下文（${part.inputTokens}/${part.thresholdTokens} token）`,
        })
        break
      case 'history-compressed':
        yield this.append(runId, conversationId, 'phase.completed', {
          phase: 'compress-history',
          summary: `已压缩 ${part.compressedMessages} 条历史消息`,
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
  toolInput: unknown,
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
    preview: createProposalPreview(isRecord(record.input)
      ? { ...record.input, beforeData: record.beforeData }
      : toolInput),
  }
}

function createProposalPreview(input: unknown): AgentChangePreview | undefined {
  const record = asRecord(input)
  const data = record.data
  if (!isRecord(data) && !isRecordArray(data)) {
    return undefined
  }
  return structuredClone({
    target: stringField(record, 'target'),
    mode: stringField(record, 'mode'),
    recordId: typeof record.recordId === 'number' ? record.recordId : undefined,
    data,
    beforeData: isRecord(record.beforeData) || isRecordArray(record.beforeData)
      ? record.beforeData
      : undefined,
  })
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

function toolPreparationSummary(descriptors: readonly ToolDescriptor[]): string {
  const tools = descriptors.map(descriptor => (
    `- **${escapeMarkdownText(descriptor.title)}**（\`${descriptor.name}\`）`
  ))
  const approvalNote = descriptors.some(descriptor => descriptor.name === PROPOSE_TOOL)
    && !descriptors.some(descriptor => descriptor.name === COMMIT_TOOL)
    ? '\n\n> `storyforge.change.commit` 仅在用户采纳方案后由宿主启用，模型不能绕过审批直接写入。'
    : ''
  return [
    `当前可调用 **${descriptors.length} 个通用工具入口**。目录工具覆盖注册表中的全部设定能力，并非只有 ${descriptors.length} 项业务功能。`,
    '',
    ...tools,
  ].join('\n') + approvalNote
}

function escapeMarkdownText(value: string): string {
  const specials = new Set('\\`*_{}[]()#+-.!|>')
  return [...value].map(character => specials.has(character) ? `\\${character}` : character).join('')
}

function buildInstructions(descriptors: readonly ToolDescriptor[], input: AgentRunInput): string {
  const scope = [
    input.scope.worldGroupId != null ? `世界ID=${input.scope.worldGroupId}` : '',
    input.scope.outlineNodeId != null ? `大纲节点ID=${input.scope.outlineNodeId}` : '',
    input.scope.chapterId != null ? `章节ID=${input.scope.chapterId}` : '',
    input.scope.entityId != null ? `实体ID=${input.scope.entityId}` : '',
  ].filter(Boolean).join('；')
  const completion = input.completionRequirement
    ? [
        `本轮受完成契约约束：必须调用 ${PROPOSE_TOOL}，目标 ${input.completionRequirement.target}/${input.completionRequirement.mode}${input.completionRequirement.recordId != null ? `/recordId=${input.completionRequirement.recordId}` : ''}。`,
        input.completionRequirement.requiredContextSources?.length
          ? `直接用 ${CONTEXT_READ_TOOL} 读取宿主指定的 requiredContextSources；这些项目读取工具已经由宿主授权，不得向用户索要读取权限、原文或粘贴内容。不要先查目录，并尽量一次读取：${input.completionRequirement.requiredContextSources.join(', ')}。`
          : '',
        input.completionRequirement.requiredPreProposalTools?.length
          ? `创建提案前必须调用并通过质量门：${input.completionRequirement.requiredPreProposalTools.join(', ')}；只有工具返回 canPropose=true 才能提案。`
          : '',
        '在提案工具调用前完成正式内容生成，把完整候选版本放进 data；流程说明、方案询问、权限请求、占位内容和“下一步将生成”都不是可采纳交付物。',
      ].filter(Boolean).join('\n')
    : ''
  const promptProfile = formatPromptProfile(input.promptProfile)
  return [
    '你是 StoryForge 项目副驾。优先使用工具获取事实，不得猜测项目设定。',
    '每轮最多调用一次 storyforge.settings.catalog；目录返回后立即执行下一工具，不要重复复述“先查看”或再次查询目录。',
    '“真实与幻想”及其大类、子类、总览属于 worldRulesProfiles，不属于 worldviews.rules。先从能力目录取得 nodeId，读取 worldRules，再用 storyforge.change.propose 对 worldRulesProfiles.entries 做节点级修改。',
    '用户按“第 N 章”指代章节且宿主未提供章节 ID 时，先调用 storyforge.context.read 读取 chapterIndex，并传 chapterOrdinal=N；再把返回的 outlineNodeId/chapterId 传给后续 context.read。',
    '写章节时：chapterId=未创建则对 chapters 使用 mode=add，并携带索引返回的 outlineNodeId、标题、正文、字数、draft 状态和章序；已有 chapterId 则使用 recordId 定点 replace，禁止新建重复章节。',
    '找到目标章节后立即读取写作所需上下文并产出变更提案；不得只描述下一步、不得用反复读取代替执行。',
    '所有已列出的项目工具都已获得当前作用域所需授权。工具返回 omitted 表示该源当前没有数据，不表示缺少权限；不得要求用户授权读取、提供原文或粘贴项目中已有内容。',
    '如果任务来自项目面板，宿主消息中给出的记录 ID、世界、章节、字段和选区是权威目标；不得改写为其它记录，也不得自行切换作用域。',
    '任何修改必须调用 storyforge.change.propose 生成方案；提案后立即停止并等待用户批准，不得声称已经写入。',
    '回答使用中文，清楚说明已读取的事实、当前阶段和下一步。只输出简短的阶段性推理摘要。',
    promptProfile,
    completion,
    `当前界面模块：${input.scope.module || '未知'}。`,
    `当前宿主作用域：${scope || '项目级'}。`,
    `可用工具：${descriptors.map(tool => tool.name).join(', ') || '无'}。`,
  ].join('\n')
}

function formatPromptProfile(profile: AgentPromptProfile | undefined): string {
  if (!profile) return ''
  const sections = [
    `【本轮激活提示词】${profile.name}（${profile.moduleKey}）`,
    '以下内容来自用户提示词库，是本轮创作方法、文风和质量要求。必须实际遵循；其中 {{变量}} 应使用面板输入或项目读取工具返回的事实填充，不得因尚未读取而忽略整段模板。',
    `【系统提示词】\n${profile.systemPrompt}`,
    `【用户提示词模板】\n${profile.userPromptTemplate}`,
  ]
  if (profile.parameterValues && Object.keys(profile.parameterValues).length > 0) {
    sections.push(`【模板参数】\n${JSON.stringify(profile.parameterValues, null, 2)}`)
  }
  if (profile.goodExamples?.length) {
    sections.push(`【认可示例】\n${profile.goodExamples.map((example, index) => `[${index + 1}] ${example}`).join('\n\n')}`)
  }
  if (profile.badExamples?.length) {
    sections.push(`【反例，必须避免】\n${profile.badExamples.map((example, index) => `[${index + 1}] ${example}`).join('\n\n')}`)
  }
  sections.push('提示词模板若要求直接输出正文或 JSON，必须把该正式结果放入 storyforge.change.propose 的 data 中，不能绕过审批，也不能把工具参数说明写入小说正文。')
  return sections.join('\n\n')
}

function applyPromptModelOverride(
  config: AgentModelConfig,
  profile: AgentPromptProfile | undefined,
): AgentModelConfig {
  if (!profile?.modelOverride) return config
  return {
    ...config,
    temperature: profile.modelOverride.temperature ?? config.temperature,
    maxTokens: profile.modelOverride.maxTokens ?? config.maxTokens,
  }
}

function assertCompletionProposalInput(
  requirement: AgentChangeProposalCompletionRequirement,
  value: unknown,
  readContextSources: ReadonlySet<string>,
): void {
  const missingSources = missingRequiredSources(requirement, readContextSources)
  if (missingSources.length > 0) {
    throw new Error(`[agent-runtime] 完成条件未满足：先读取上下文源 ${missingSources.join('、')}`)
  }

  const input = asRecord(value)
  if (input.target !== requirement.target) {
    throw new Error(`[agent-runtime] 完成条件未满足：提案 target 必须是 ${requirement.target}`)
  }
  if (input.mode !== requirement.mode) {
    throw new Error(`[agent-runtime] 完成条件未满足：提案 mode 必须是 ${requirement.mode}`)
  }
  if (requirement.recordId != null && input.recordId !== requirement.recordId) {
    throw new Error(`[agent-runtime] 完成条件未满足：提案 recordId 必须是 ${requirement.recordId}`)
  }
  if (requirement.target === 'chapters'
    && requirement.recordId == null
    && (typeof input.recordId !== 'number' || input.recordId <= 0)) {
    throw new Error('[agent-runtime] 完成条件未满足：章节提案必须包含通过 chapterIndex 定位的 recordId')
  }

  const dataItems = isRecordArray(input.data)
    ? input.data
    : isRecord(input.data) ? [input.data] : []
  if (dataItems.length === 0) {
    throw new Error('[agent-runtime] 完成条件未满足：提案 data 不能为空')
  }
  for (const field of requirement.requiredFields) {
    for (const item of dataItems) {
      const fieldValue = item[field]
      if (fieldValue == null || (typeof fieldValue === 'string' && fieldValue.trim() === '')) {
        throw new Error(`[agent-runtime] 完成条件未满足：提案缺少 ${field}`)
      }
      const minLength = requirement.minTextLength?.[field]
      if (minLength != null && textContentLength(fieldValue) < minLength) {
        throw new Error(`[agent-runtime] 完成条件未满足：${field} 正文不足 ${minLength} 字，请生成完整内容`)
      }
    }
  }
  for (const path of requirement.requiredDataPaths ?? []) {
    for (const item of dataItems) {
      const value = valueAtPath(item, path)
      if (value == null || (typeof value === 'string' && value.trim() === '')) {
        throw new Error(`[agent-runtime] 完成条件未满足：提案缺少精确路径 ${path.join(' → ')}`)
      }
    }
  }

  assertDeliverableContent(requirement, dataItems)
}

function assertDeliverableContent(
  requirement: AgentChangeProposalCompletionRequirement,
  dataItems: readonly Record<string, unknown>[],
): void {
  if (requirement.deliverableKind !== 'chapter-draft'
    && requirement.deliverableKind !== 'chapter-rewrite') return

  for (const item of dataItems) {
    const content = typeof item.content === 'string' ? item.content : ''
    const plainContent = plainTextContent(content)
    if (containsNonDeliverableMetaContent(plainContent)) {
      throw new Error(
        '[agent-runtime] 完成条件未满足：content 必须是正式小说正文，不能包含权限请求、索要原文、流程说明或占位内容；请继续调用项目读取工具并生成完整正文',
      )
    }

    const sourceLength = requirement.sourceTextLength
    const minRatio = requirement.minLengthRatio
    if (requirement.deliverableKind === 'chapter-rewrite'
      && sourceLength != null
      && sourceLength > 0
      && minRatio != null) {
      const minimum = Math.ceil(sourceLength * minRatio)
      if (textContentLength(content) < minimum) {
        throw new Error(
          `[agent-runtime] 完成条件未满足：改写后的完整章节不足原文的 ${Math.round(minRatio * 100)}%（至少 ${minimum} 字），不能用摘要、说明或局部片段替代正文`,
        )
      }
    }
  }
}

function containsNonDeliverableMetaContent(content: string): boolean {
  const normalized = content.replace(/\s+/g, '')
  return [
    /[【[]?(?:正文|内容|章节内容)?待定[】\]]?/,
    /(?:当前)?工具集.{0,24}(?:缺少|没有|不支持)/,
    /storyforge\.(?:context|settings|change)\./i,
    /(?:请|需要)(?:先)?(?:提供|粘贴|上传).{0,24}(?:原文|正文|章节内容)/,
    /(?:请|需要).{0,20}(?:赋予|开放|授予).{0,12}(?:读取|访问)?权限/,
    /(?:无法|不能|尚未|未能).{0,20}(?:读取|获取|访问).{0,20}(?:原文|正文|章节内容)/,
    /(?:获取|读取).{0,12}(?:原文|正文|章节内容).{0,16}(?:后|才能)(?:执行|改写|润色|生成)/,
    /(?:以下|提供).{0,12}(?:方案|选项).{0,28}(?:请选择|请确认|是否采纳)/,
    /(?:请确认|请选择).{0,20}(?:方案|方向|要求|风格)/,
    /(?:我将|接下来|下一步).{0,20}(?:生成|改写|润色|处理).{0,16}(?:正文|章节内容|本章)/,
  ].some(pattern => pattern.test(normalized))
}

function requiredContextIsReady(
  requirement: AgentChangeProposalCompletionRequirement | undefined,
  readContextSources: ReadonlySet<string>,
): boolean {
  return requirement != null && missingRequiredSources(requirement, readContextSources).length === 0
}

function missingRequiredSources(
  requirement: AgentChangeProposalCompletionRequirement,
  readContextSources: ReadonlySet<string>,
): string[] {
  return (requirement.requiredContextSources ?? []).filter(source => !readContextSources.has(source))
}

function completionFailureMessage(
  requirement: AgentChangeProposalCompletionRequirement,
  readContextSources: ReadonlySet<string>,
  lastCompletionError = '',
): string {
  const missing = missingRequiredSources(requirement, readContextSources)
  const message = missing.length > 0
    ? `Agent 未完成任务：尚未读取 ${missing.join('、')}，也未生成可采纳方案。`
    : `Agent 未完成任务：没有生成符合 ${requirement.target}/${requirement.mode} 完成条件的可采纳方案。`
  return lastCompletionError ? `${message}\n最近一次提案被拒绝：${lastCompletionError}` : message
}

function completionRequirementReminder(
  requirement: AgentChangeProposalCompletionRequirement,
): string {
  const record = requirement.recordId != null ? `，recordId=${requirement.recordId}` : ''
  const paths = requirement.requiredDataPaths?.length
    ? `\n必须包含精确数据路径：${requirement.requiredDataPaths.map(path => path.join(' → ')).join('、')}。`
    : ''
  return [
    `提案参数必须为 target=${requirement.target}，mode=${requirement.mode}${record}。`,
    `data 必须直接包含正式结果对象，不要包在 plan、proposal 或 character 等额外层级中；必填字段：${requirement.requiredFields.join('、')}。${paths}`,
    requirement.requiredPreProposalTools?.length
      ? `提案前必须调用并通过质量门：${requirement.requiredPreProposalTools.join('、')}；工具必须返回 canPropose=true。`
      : '',
  ].filter(Boolean).join('\n')
}

function assertPreProposalToolsPassed(
  requirement: AgentChangeProposalCompletionRequirement,
  passedTools: ReadonlySet<string>,
): void {
  const missing = (requirement.requiredPreProposalTools ?? []).filter(tool => !passedTools.has(tool))
  if (missing.length) {
    throw new Error(`提案前质量门尚未通过：${missing.join('、')}。请先调用工具并修正到 canPropose=true。`)
  }
}

function valueAtPath(root: Readonly<Record<string, unknown>>, path: readonly string[]): unknown {
  let current: unknown = root
  for (const segment of path) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return current
}

function textContentLength(value: unknown): number {
  if (typeof value !== 'string') return 0
  return plainTextContent(value)
    .replace(/\s/g, '')
    .length
}

function plainTextContent(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/gi, ' ')
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

function defaultMaxSteps(requirement: AgentCompletionRequirement | undefined): number {
  if (!requirement) return DEFAULT_MAX_STEPS
  return Math.min(
    MAX_STEPS,
    Math.max(
      DEFAULT_REQUIRED_MAX_STEPS,
      (requirement.requiredContextSources?.length ?? 0) + REQUIRED_COMPLETION_STEP_RESERVE,
      (requirement.requiredPreProposalTools?.length ?? 0) + REQUIRED_COMPLETION_STEP_RESERVE,
    ),
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord)
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function acknowledgedContextSources(input: unknown, output: unknown): string[] {
  const requested = new Set(stringArrayField(asRecord(input), 'sourceKeys'))
  const result = asRecord(output)
  return ['included', 'omitted', 'trimmed']
    .flatMap(field => stringArrayField(result, field))
    .filter(source => requested.has(source))
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
