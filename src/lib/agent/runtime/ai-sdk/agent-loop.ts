import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  ToolLoopAgent,
  dynamicTool,
  jsonSchema,
  stepCountIs,
  type ModelMessage,
  type ToolSet,
} from 'ai'
import type { ToolDescriptor } from '../../tools/tool-types'
import type { AgentHistoryMessage } from '../agent-runtime-port'
import { buildOpenAIEndpoint } from '../../../ai/openai-endpoint'

export interface AgentModelConfig {
  readonly provider: string
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
  readonly temperature?: number
  readonly maxTokens?: number
}

export type AgentLoopPart =
  | { readonly type: 'phase-start'; readonly step: number }
  | { readonly type: 'phase-end'; readonly step: number }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'reasoning'; readonly text: string }
  | { readonly type: 'tool-call'; readonly toolCallId: string; readonly toolName: string; readonly input: unknown }
  | { readonly type: 'tool-result'; readonly toolCallId: string; readonly toolName: string; readonly output: unknown }
  | { readonly type: 'tool-error'; readonly toolCallId: string; readonly toolName: string; readonly error: unknown }
  | { readonly type: 'abort'; readonly reason?: string }
  | { readonly type: 'error'; readonly error: unknown }

export interface AgentLoopRequest {
  readonly config: AgentModelConfig
  readonly instructions: string
  readonly prompt: string
  readonly conversationHistory?: readonly AgentHistoryMessage[]
  readonly descriptors: readonly ToolDescriptor[]
  readonly maxSteps: number
  readonly tokenBudget?: number
  readonly signal: AbortSignal
  readonly execute: (toolName: string, input: unknown) => Promise<unknown>
  readonly shouldStop: () => boolean
  readonly requiredContextTool?: string
  readonly requiredCompletionTool?: string
  readonly requiredCompletionReminder?: string
  readonly shouldForceCompletion?: () => boolean
  readonly remainingContextSources?: () => readonly string[]
}

export type AgentLoopStreamer = (request: AgentLoopRequest) => AsyncIterable<AgentLoopPart>

export async function* streamAiSdkAgentLoop(
  request: AgentLoopRequest,
): AsyncIterable<AgentLoopPart> {
  const provider = createOpenAICompatible({
    name: request.config.provider || 'storyforge',
    baseURL: normalizeBaseUrl(request.config.baseUrl),
    apiKey: request.config.apiKey || undefined,
    includeUsage: true,
    fetch: async (_input, init) => await fetch(buildOpenAIEndpoint(
      request.config.baseUrl,
      'chat/completions',
      {},
    ), init),
  })
  const toolNames = createToolNameMap(request.descriptors)
  const completionToolName = request.requiredCompletionTool
    ? toolNames.toSdk.get(request.requiredCompletionTool)
    : undefined
  const contextToolName = request.requiredContextTool
    ? toolNames.toSdk.get(request.requiredContextTool)
    : undefined
  if (request.requiredCompletionTool && !completionToolName) {
    throw new Error(`[agent-loop] required completion tool is unavailable: ${request.requiredCompletionTool}`)
  }
  if (request.requiredContextTool && !contextToolName) {
    throw new Error(`[agent-loop] required context tool is unavailable: ${request.requiredContextTool}`)
  }
  const autoOnlyToolChoice = usesAutoOnlyToolChoice(request.config)
  const tools: ToolSet = {}

  for (const descriptor of request.descriptors) {
    const sdkName = toolNames.toSdk.get(descriptor.name)
    if (!sdkName) continue
    tools[sdkName] = dynamicTool({
      description: `${descriptor.title}\n${descriptor.description}`,
      inputSchema: jsonSchema(descriptor.inputSchema as never),
      execute: async input => await request.execute(descriptor.name, input),
    })
  }

  let step = 0
  let consumedOutputTokens = 0
  let messages: ModelMessage[] | undefined = request.conversationHistory?.length
    ? [
        ...request.conversationHistory.map(message => ({
          role: message.role,
          content: message.content,
        } satisfies ModelMessage)),
        { role: 'user', content: request.prompt },
      ]
    : undefined
  const hasTokenBudget = request.tokenBudget != null

  while (step < request.maxSteps
    && (!hasTokenBudget || consumedOutputTokens < request.tokenBudget!)
    && !request.shouldStop()) {
    const remainingSteps = request.maxSteps - step
    const remainingTokens = hasTokenBudget ? request.tokenBudget! - consumedOutputTokens : undefined
    const agent = new ToolLoopAgent({
      id: 'storyforge-copilot',
      model: provider(request.config.model),
      instructions: request.instructions,
      tools,
      temperature: request.config.temperature,
      maxOutputTokens: normalizeOutputLimit(request.config.maxTokens, remainingTokens),
      toolChoice: completionToolName ? (autoOnlyToolChoice ? 'auto' : 'required') : undefined,
      prepareStep: completionToolName
        ? ({ stepNumber }) => ({
            ...(autoOnlyToolChoice
              ? {
                  activeTools: [request.shouldForceCompletion?.() || !contextToolName
                    ? completionToolName
                    : contextToolName],
                  toolChoice: 'auto' as const,
                }
              : {
                  toolChoice: request.shouldForceCompletion?.() || stepNumber >= remainingSteps - 1
                    ? { type: 'tool' as const, toolName: completionToolName }
                    : 'required' as const,
                }),
          })
        : undefined,
      stopWhen: [
        stepCountIs(remainingSteps),
        ({ steps }) => request.shouldStop()
          || (remainingTokens != null && totalOutputTokens(steps) >= remainingTokens),
      ],
    })
    const result = messages
      ? await agent.stream({ messages, abortSignal: request.signal })
      : await agent.stream({ prompt: request.prompt, abortSignal: request.signal })

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'start-step':
          step += 1
          yield { type: 'phase-start', step }
          break
        case 'finish-step':
          yield { type: 'phase-end', step }
          break
        case 'text-delta':
          yield { type: 'text', text: part.text }
          break
        case 'reasoning-delta':
          yield { type: 'reasoning', text: part.text }
          break
        case 'tool-call':
          yield {
            type: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: toolNames.fromSdk.get(part.toolName) ?? part.toolName,
            input: part.input,
          }
          break
        case 'tool-result':
          yield {
            type: 'tool-result',
            toolCallId: part.toolCallId,
            toolName: toolNames.fromSdk.get(part.toolName) ?? part.toolName,
            output: part.output,
          }
          break
        case 'tool-error':
          yield {
            type: 'tool-error',
            toolCallId: part.toolCallId,
            toolName: toolNames.fromSdk.get(part.toolName) ?? part.toolName,
            error: part.error,
          }
          break
        case 'abort':
          yield { type: 'abort', reason: part.reason }
          break
        case 'error':
          yield { type: 'error', error: part.error }
          break
        default:
          break
      }
    }

    consumedOutputTokens += (await result.usage).outputTokens ?? 0
    if (request.shouldStop()
      || !autoOnlyToolChoice
      || !completionToolName
      || step >= request.maxSteps
      || (hasTokenBudget && consumedOutputTokens >= request.tokenBudget!)) {
      return
    }

    const responseMessages = await result.responseMessages
    messages = messages
      ? [...messages, ...responseMessages]
      : [{ role: 'user', content: request.prompt }, ...responseMessages]
    messages.push({
      role: 'user',
      content: request.shouldForceCompletion?.()
        ? `宿主完成契约尚未满足。不要只描述下一步；现在必须调用 ${request.requiredCompletionTool}，提交完整可采纳结果。${request.requiredCompletionReminder ? `\n${request.requiredCompletionReminder}` : ''}`
        : `宿主完成契约尚未满足。继续调用 ${request.requiredContextTool} 读取尚缺上下文：${request.remainingContextSources?.().join('、') || '按宿主清单继续读取'}。不要重复读取已完成源，不要停止或只输出说明。`,
    })
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function normalizeOutputLimit(configured: number | undefined, budget: number | undefined): number | undefined {
  if (configured && configured > 0) return budget == null ? configured : Math.min(configured, budget)
  return budget
}

function usesAutoOnlyToolChoice(config: AgentModelConfig): boolean {
  // DeepSeek 的 OpenAI-compatible Chat Completions 接口只接受 auto/none；
  // required 和指定函数都会返回 InvalidParameter。通过 activeTools 仍将
  // 每一步收窄到当前唯一合法工具，并由完成契约做最终兜底校验。
  return /deepseek/i.test(config.model)
}

function totalOutputTokens(steps: readonly unknown[]): number {
  return steps.reduce<number>((sum, step) => {
    const usage = Reflect.get(step as object, 'usage') as Record<string, unknown> | undefined
    const value = usage?.outputTokens
    return sum + (typeof value === 'number' ? value : 0)
  }, 0)
}

function createToolNameMap(descriptors: readonly ToolDescriptor[]): {
  toSdk: ReadonlyMap<string, string>
  fromSdk: ReadonlyMap<string, string>
} {
  const toSdk = new Map<string, string>()
  const fromSdk = new Map<string, string>()
  for (const descriptor of descriptors) {
    const base = descriptor.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 58) || 'tool'
    let candidate = base
    let suffix = 2
    while (fromSdk.has(candidate)) {
      candidate = `${base.slice(0, 55)}_${suffix}`
      suffix += 1
    }
    toSdk.set(descriptor.name, candidate)
    fromSdk.set(candidate, descriptor.name)
  }
  return { toSdk, fromSdk }
}
