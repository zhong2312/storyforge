import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AiSdkAgentRuntimeAdapter,
  streamAiSdkAgentLoop,
  type AgentLoopPart,
  type AgentLoopStreamer,
} from '../../src/lib/agent/runtime/ai-sdk'
import { ToolRegistry } from '../../src/lib/agent/tools/tool-registry'
import type { AgentEvent } from '../../src/lib/agent/events/agent-events'

describe('AiSdkAgentRuntimeAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('runs a multi-step tool loop and normalizes phase, reasoning, tool and message events', async () => {
    const execute = vi.fn(async () => ({ readSources: ['worldview'] }))
    const registry = registryWithCatalog(execute)
    const streamer: AgentLoopStreamer = async function* (request) {
      yield { type: 'phase-start', step: 1 }
      yield { type: 'reasoning', text: '先查看可用设定。' }
      yield { type: 'tool-call', toolCallId: 'call-1', toolName: 'storyforge.settings.catalog', input: {} }
      const output = await request.execute('storyforge.settings.catalog', {})
      yield { type: 'tool-result', toolCallId: 'call-1', toolName: 'storyforge.settings.catalog', output }
      yield { type: 'phase-end', step: 1 }
      yield { type: 'text', text: '已读取项目设定目录。' }
    }
    const runtime = createRuntime(registry, streamer)

    const events = await collect(runtime.run(runInput()))

    expect(execute).toHaveBeenCalledOnce()
    expect(events.map(event => event.type)).toEqual(expect.arrayContaining([
      'run.started',
      'phase.started',
      'reasoning.summary.delta',
      'reasoning.summary.completed',
      'tool.requested',
      'tool.started',
      'tool.completed',
      'message.delta',
      'message.completed',
      'run.completed',
    ]))
    expect(events.map(event => event.sequence)).toEqual(events.map((_, index) => index + 1))
  })

  it('pauses after a change proposal and commits only after matching approval', async () => {
    let committed = false
    const registry = new ToolRegistry()
    registry.register({
      name: 'storyforge.change.propose',
      title: '生成变更方案',
      description: 'proposal',
      inputSchema: { type: 'object' },
      risk: 'write',
      availability: 'both',
      requiredScopes: ['project:read'],
      async execute() {
        return {
          planId: 'plan-1',
          approvalId: 'approval-1',
          planHash: 'hash-1',
          preview: { target: 'worldviews', itemCount: 1, canonicalFields: ['worldOrigin'] },
        }
      },
    })
    registry.register({
      name: 'storyforge.change.commit',
      title: '提交变更',
      description: 'commit',
      inputSchema: { type: 'object' },
      risk: 'write',
      availability: 'both',
      requiredScopes: ['project:write'],
      async execute(context, input) {
        expect(context.approval).toEqual({ approvalId: 'approval-1', planHash: 'hash-1' })
        expect(input).toEqual({ planId: 'plan-1' })
        committed = true
        return { written: [{}] }
      },
    })
    const streamer: AgentLoopStreamer = async function* (request) {
      yield { type: 'tool-call', toolCallId: 'call-1', toolName: 'storyforge.change.propose', input: {} }
      const output = await request.execute('storyforge.change.propose', {})
      yield { type: 'tool-result', toolCallId: 'call-1', toolName: 'storyforge.change.propose', output }
    }
    const runtime = createRuntime(registry, streamer)

    const first = await collect(runtime.run(runInput()))
    const approval = first.find(event => event.type === 'approval.requested')
    expect(approval?.type).toBe('approval.requested')
    expect(first.some(event => event.type === 'run.completed')).toBe(false)
    expect(committed).toBe(false)

    const resumed = await collect(runtime.resume(first[0].runId, {
      approvalId: 'approval-1',
      decision: 'approved',
    }))
    expect(committed).toBe(true)
    expect(resumed.map(event => event.type)).toEqual([
      'approval.resolved',
      'phase.started',
      'tool.requested',
      'tool.started',
      'tool.completed',
      'phase.completed',
      'message.completed',
      'run.completed',
    ])
  })

  it('rejects or edits a plan without granting the commit tool', async () => {
    const registry = proposalRegistry()
    const runtime = createRuntime(registry, proposalStreamer())
    const first = await collect(runtime.run(runInput()))

    const events = await collect(runtime.resume(first[0].runId, {
      approvalId: 'approval-1',
      decision: 'edited',
      editedPlan: { worldOrigin: 'new' },
    }))

    expect(events.map(event => event.type)).toEqual([
      'approval.resolved',
      'message.completed',
      'run.completed',
    ])
    expect((events[1] as Extract<AgentEvent, { type: 'message.completed' }>).payload.text).toContain('重新生成')
  })

  it('cancels an active run through AbortSignal', async () => {
    const streamer: AgentLoopStreamer = async function* (request) {
      if (!request.signal.aborted) {
        await new Promise<void>(resolve => request.signal.addEventListener('abort', () => resolve(), { once: true }))
      }
      yield { type: 'abort', reason: 'stopped' }
    }
    const runtime = createRuntime(registryWithCatalog(async () => ({})), streamer)
    const events: AgentEvent[] = []
    const consume = (async () => {
      for await (const event of runtime.run(runInput())) {
        events.push(event)
        if (event.type === 'run.started') await runtime.cancel(event.runId)
      }
    })()

    await consume
    expect(events.at(-1)?.type).toBe('run.cancelled')
  })

  it('uses the real ToolLoopAgent for an OpenAI-compatible two-step tool call', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown>,
      })
      return requests.length === 1
        ? sseResponse(toolCallChunks())
        : sseResponse(textChunks('已读取设定目录。'))
    })
    vi.stubGlobal('fetch', fetchMock)
    const execute = vi.fn(async () => ({ readSources: ['worldview'] }))
    const descriptor = registryWithCatalog(execute).get('storyforge.settings.catalog')
    if (!descriptor) throw new Error('missing descriptor')

    const parts: AgentLoopPart[] = []
    for await (const part of streamAiSdkAgentLoop({
      config: {
        provider: 'custom', apiKey: 'test-key', baseUrl: 'https://example.com/v1', model: 'test-model',
      },
      instructions: 'Use the catalog tool.',
      prompt: '查看设定',
      descriptors: [descriptor],
      maxSteps: 4,
      tokenBudget: 2_000,
      signal: new AbortController().signal,
      execute: async (name, input) => {
        expect(name).toBe('storyforge.settings.catalog')
        return await execute(input)
      },
      shouldStop: () => false,
    })) parts.push(part)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requests[0].url).toContain('/openai-compatible-proxy/chat/completions')
    expect(JSON.stringify(requests[0].body)).toContain('storyforge_settings_catalog')
    expect(JSON.stringify(requests[1].body)).toContain('readSources')
    expect(execute).toHaveBeenCalledOnce()
    expect(parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool-call', toolName: 'storyforge.settings.catalog' }),
      expect.objectContaining({ type: 'tool-result', toolName: 'storyforge.settings.catalog' }),
      expect.objectContaining({ type: 'text', text: '已读取设定目录。' }),
    ]))
  })
})

function createRuntime(registry: ToolRegistry, streamer: AgentLoopStreamer) {
  return new AiSdkAgentRuntimeAdapter({
    getModelConfig: () => ({
      provider: 'test', apiKey: '', baseUrl: 'http://localhost/v1', model: 'test-model',
    }),
    createToolRegistry: async () => registry,
    platform: 'web',
    grantedScopes: ['project:read'],
    streamer,
  })
}

function registryWithCatalog(execute: () => Promise<unknown>): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register({
    name: 'storyforge.settings.catalog',
    title: '查看设定目录',
    description: 'catalog',
    inputSchema: { type: 'object' },
    risk: 'read',
    availability: 'both',
    requiredScopes: ['project:read'],
    execute: async () => await execute(),
  })
  return registry
}

function proposalRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register({
    name: 'storyforge.change.propose',
    title: '生成变更方案',
    description: 'proposal',
    inputSchema: { type: 'object' },
    risk: 'write',
    availability: 'both',
    requiredScopes: ['project:read'],
    async execute() {
      return {
        planId: 'plan-1', approvalId: 'approval-1', planHash: 'hash-1',
        preview: { target: 'worldviews', itemCount: 1 },
      }
    },
  })
  return registry
}

function proposalStreamer(): AgentLoopStreamer {
  return async function* (request) {
    yield { type: 'tool-call', toolCallId: 'call-1', toolName: 'storyforge.change.propose', input: {} }
    const output = await request.execute('storyforge.change.propose', {})
    yield { type: 'tool-result', toolCallId: 'call-1', toolName: 'storyforge.change.propose', output }
  }
}

function runInput() {
  return {
    conversationId: 'conversation-1',
    project: { backend: 'dexie' as const, projectId: 1 },
    scope: { module: 'worldview-origin' },
    userMessage: '查看并完善世界起源',
  }
}

async function collect(iterable: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of iterable) events.push(event)
  return events
}

function sseResponse(chunks: readonly Record<string, unknown>[]): Response {
  const body = `${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function toolCallChunks(): Record<string, unknown>[] {
  return [
    completionChunk({
      role: 'assistant',
      tool_calls: [{
        index: 0,
        id: 'call-1',
        type: 'function',
        function: { name: 'storyforge_settings_catalog', arguments: '{}' },
      }],
    }, null),
    completionChunk({}, 'tool_calls'),
  ]
}

function textChunks(text: string): Record<string, unknown>[] {
  return [completionChunk({ role: 'assistant', content: text }, null), completionChunk({}, 'stop')]
}

function completionChunk(delta: Record<string, unknown>, finishReason: string | null): Record<string, unknown> {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'test-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  }
}
