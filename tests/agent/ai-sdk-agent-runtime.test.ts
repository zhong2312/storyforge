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
      expect(request.instructions).toContain('chapterIndex')
      expect(request.tokenBudget).toBeUndefined()
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
    const completedTool = events.find(event => event.type === 'tool.completed')
    expect(completedTool?.type === 'tool.completed' ? completedTool.payload.output : undefined)
      .toEqual({ readSources: ['worldview'] })
    const preparation = events.find(event => (
      event.type === 'phase.completed' && event.payload.phase === 'prepare'
    ))
    expect(preparation?.type).toBe('phase.completed')
    if (preparation?.type !== 'phase.completed') throw new Error('missing preparation phase')
    expect(preparation.payload.summary).toContain('1 个通用工具入口')
    expect(preparation.payload.summary).toContain('查看设定目录')
    expect(preparation.payload.summary).toContain('storyforge.settings.catalog')
  })

  it('passes prior visible conversation messages to the model loop', async () => {
    const registry = registryWithCatalog(vi.fn(async () => ({})))
    const streamer: AgentLoopStreamer = async function* (request) {
      expect(request.prompt).toBe('那第二章呢？')
      expect(request.conversationHistory).toEqual([
        { role: 'user', content: '第一章写了什么？' },
        { role: 'assistant', content: '第一章写了林川进入山门。' },
      ])
      yield { type: 'text', text: '第二章继续山门试炼。' }
    }
    const runtime = createRuntime(registry, streamer)

    const events = await collect(runtime.run({
      ...runInput(),
      userMessage: '那第二章呢？',
      conversationHistory: [
        { role: 'user', content: '第一章写了什么？' },
        { role: 'assistant', content: '第一章写了林川进入山门。' },
      ],
    }))

    expect(events.some(event => event.type === 'run.completed')).toBe(true)
  })

  it('injects the active prompt-library profile and applies its model overrides', async () => {
    const registry = registryWithCatalog(vi.fn(async () => ({})))
    const streamer: AgentLoopStreamer = async function* (request) {
      expect(request.instructions).toContain('【本轮激活提示词】我的角色模板（character.generate）')
      expect(request.instructions).toContain('塑造有矛盾感的人物')
      expect(request.instructions).toContain('姓名：{{name}}')
      expect(request.instructions).toContain('认可示例')
      expect(request.config.temperature).toBe(0.85)
      expect(request.config.maxTokens).toBe(6000)
      yield { type: 'text', text: '已使用角色模板。' }
    }
    const runtime = createRuntime(registry, streamer)

    const events = await collect(runtime.run({
      ...runInput(),
      promptProfile: {
        moduleKey: 'character.generate',
        name: '我的角色模板',
        systemPrompt: '塑造有矛盾感的人物',
        userPromptTemplate: '姓名：{{name}}',
        parameterValues: { detailLevel: '详尽' },
        goodExamples: ['人物选择体现性格'],
        modelOverride: { temperature: 0.85, maxTokens: 6000 },
      },
    }))

    expect(events.some(event => event.type === 'run.completed')).toBe(true)
    const prepared = events.find(event => event.type === 'phase.completed')
    expect(prepared?.type === 'phase.completed' ? prepared.payload.summary : '').toContain('已加载提示词“我的角色模板”')
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
    const discardPlan = vi.fn()
    const runtime = createRuntime(registry, proposalStreamer(), discardPlan)
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
    expect(discardPlan).toHaveBeenCalledWith('plan-1')
    await expect(collect(runtime.resume(first[0].runId, {
      approvalId: 'approval-1', decision: 'approved',
    }))).rejects.toThrow('not awaiting approval')
  })

  it('keeps a proposal pending when commit fails and allows retry', async () => {
    const registry = proposalRegistry()
    let attempts = 0
    registry.register({
      name: 'storyforge.change.commit',
      title: '提交变更',
      description: 'commit',
      inputSchema: { type: 'object' },
      risk: 'write',
      availability: 'both',
      requiredScopes: ['project:write'],
      async execute() {
        attempts += 1
        if (attempts === 1) throw new Error('temporary write failure')
        return { written: [{}] }
      },
    })
    const runtime = createRuntime(registry, proposalStreamer())
    const first = await collect(runtime.run(runInput()))
    const runId = first[0].runId

    const failed = await collect(runtime.resume(runId, {
      approvalId: 'approval-1', decision: 'approved',
    }))

    const retryApproval = failed.at(-1)
    expect(retryApproval).toMatchObject({
      type: 'approval.requested',
      payload: {
        summary: expect.stringContaining('temporary write failure'),
      },
    })
    if (retryApproval?.type !== 'approval.requested') throw new Error('missing retry approval')
    expect(retryApproval.payload.approvalId).not.toBe('approval-1')
    expect(failed.some(event => event.type === 'run.failed')).toBe(false)

    const retried = await collect(runtime.resume(runId, {
      approvalId: retryApproval.payload.approvalId, decision: 'approved',
    }))

    expect(attempts).toBe(2)
    expect(retried.at(-1)?.type).toBe('run.completed')
    await expect(collect(runtime.resume(runId, {
      approvalId: 'approval-1', decision: 'approved',
    }))).rejects.toThrow('not awaiting approval')
  })

  it('fails instead of reporting success when a constrained chapter run only reads context', async () => {
    const registry = chapterProposalRegistry()
    const streamer: AgentLoopStreamer = async function* (request) {
      expect(request.requiredContextTool).toBe('storyforge.context.read')
      expect(request.requiredCompletionTool).toBe('storyforge.change.propose')
      expect(request.shouldForceCompletion?.()).toBe(false)
      yield {
        type: 'tool-call', toolCallId: 'read-1', toolName: 'storyforge.context.read',
        input: { sourceKeys: ['chapterOutline'] },
      }
      const output = await request.execute('storyforge.context.read', { sourceKeys: ['chapterOutline'] })
      yield {
        type: 'tool-result', toolCallId: 'read-1', toolName: 'storyforge.context.read', output,
      }
      expect(request.shouldForceCompletion?.()).toBe(true)
      yield { type: 'text', text: '接下来开始生成正文。' }
    }

    const events = await collect(createRuntime(registry, streamer).run(chapterRunInput()))

    expect(events.some(event => event.type === 'run.completed')).toBe(false)
    expect(events.at(-1)).toMatchObject({
      type: 'run.failed',
      payload: { error: expect.stringContaining('没有生成符合 chapters/replace') },
    })
  })

  it('reserves completion steps beyond the required context source count', async () => {
    const sources = Array.from({ length: 25 }, (_, index) => `source-${index + 1}`)
    let maxSteps = 0
    const streamer: AgentLoopStreamer = async function* (request) {
      maxSteps = request.maxSteps
      yield { type: 'phase-start', step: 1 }
    }

    await collect(createRuntime(chapterProposalRegistry(), streamer).run(chapterRunInput({
      requiredContextSources: sources,
    })))

    expect(maxSteps).toBe(33)
  })

  it('rejects an incomplete proposal, then accepts a corrected chapter proposal with preview', async () => {
    const registry = chapterProposalRegistry()
    const validContent = '山雨压住了山门外的灯火。'.repeat(12)
    const streamer: AgentLoopStreamer = async function* (request) {
      const readInput = { sourceKeys: ['chapterOutline'] }
      yield { type: 'tool-call', toolCallId: 'read-1', toolName: 'storyforge.context.read', input: readInput }
      const readOutput = await request.execute('storyforge.context.read', readInput)
      yield { type: 'tool-result', toolCallId: 'read-1', toolName: 'storyforge.context.read', output: readOutput }

      const invalid = { target: 'chapters', mode: 'replace', recordId: 12, data: { content: '' } }
      yield { type: 'tool-call', toolCallId: 'proposal-1', toolName: 'storyforge.change.propose', input: invalid }
      try {
        await request.execute('storyforge.change.propose', invalid)
        throw new Error('invalid proposal unexpectedly passed')
      } catch (error) {
        expect(String(error)).toContain('提案缺少 content')
        yield { type: 'tool-error', toolCallId: 'proposal-1', toolName: 'storyforge.change.propose', error }
      }

      const valid = {
        target: 'chapters', mode: 'replace', recordId: 12,
        data: { content: validContent, wordCount: validContent.length, status: 'draft' },
      }
      yield { type: 'tool-call', toolCallId: 'proposal-2', toolName: 'storyforge.change.propose', input: valid }
      const proposalOutput = await request.execute('storyforge.change.propose', valid)
      yield { type: 'tool-result', toolCallId: 'proposal-2', toolName: 'storyforge.change.propose', output: proposalOutput }
    }

    const events = await collect(createRuntime(registry, streamer).run(chapterRunInput()))
    const approval = events.find((event): event is Extract<AgentEvent, { type: 'approval.requested' }> => (
      event.type === 'approval.requested'
    ))

    expect(events.some(event => event.type === 'tool.failed')).toBe(true)
    expect(approval?.payload.preview).toMatchObject({
      target: 'chapters', mode: 'replace', recordId: 12, data: { content: validContent },
    })
    expect(events.some(event => event.type === 'run.completed')).toBe(false)
  })

  it('rejects permission requests and placeholder explanations as chapter deliverables', async () => {
    const registry = chapterProposalRegistry()
    const streamer: AgentLoopStreamer = async function* (request) {
      const readInput = { sourceKeys: ['chapterOutline'] }
      yield { type: 'tool-call', toolCallId: 'read-1', toolName: 'storyforge.context.read', input: readInput }
      const readOutput = await request.execute('storyforge.context.read', readInput)
      yield { type: 'tool-result', toolCallId: 'read-1', toolName: 'storyforge.context.read', output: readOutput }

      const proposal = {
        target: 'chapters', mode: 'replace', recordId: 12,
        data: {
          content: '【内容待定——需要获取第1章原文后才能执行去AI味改写。当前工具集缺少 storyforge.context.read，请赋予读取权限。',
        },
      }
      yield { type: 'tool-call', toolCallId: 'proposal-1', toolName: 'storyforge.change.propose', input: proposal }
      await request.execute('storyforge.change.propose', proposal)
    }

    const events = await collect(createRuntime(registry, streamer).run(chapterRunInput({
      minTextLength: 1,
    })))

    expect(events.at(-1)).toMatchObject({
      type: 'run.failed', payload: { error: expect.stringContaining('必须是正式小说正文') },
    })
    expect(events.some(event => event.type === 'approval.requested')).toBe(false)
  })

  it('rejects a plan-selection question even when it is long enough', async () => {
    const registry = chapterProposalRegistry()
    const streamer: AgentLoopStreamer = async function* (request) {
      const readInput = { sourceKeys: ['chapterOutline'] }
      yield { type: 'tool-call', toolCallId: 'read-1', toolName: 'storyforge.context.read', input: readInput }
      const readOutput = await request.execute('storyforge.context.read', readInput)
      yield { type: 'tool-result', toolCallId: 'read-1', toolName: 'storyforge.context.read', output: readOutput }

      const proposal = {
        target: 'chapters', mode: 'replace', recordId: 12,
        data: {
          content: `以下提供三种改写方案，请确认风格后我再生成正文。${'第一种侧重节奏，第二种侧重对白，第三种侧重氛围。'.repeat(30)}`,
        },
      }
      yield { type: 'tool-call', toolCallId: 'proposal-1', toolName: 'storyforge.change.propose', input: proposal }
      await request.execute('storyforge.change.propose', proposal)
    }

    const events = await collect(createRuntime(registry, streamer).run(chapterRunInput({
      minTextLength: 500,
    })))

    expect(events.at(-1)).toMatchObject({
      type: 'run.failed', payload: { error: expect.stringContaining('必须是正式小说正文') },
    })
    expect(events.some(event => event.type === 'approval.requested')).toBe(false)
  })

  it('rejects a chapter rewrite that replaces the full source with a short explanation', async () => {
    const registry = chapterProposalRegistry()
    const streamer: AgentLoopStreamer = async function* (request) {
      const readInput = { sourceKeys: ['chapterOutline'] }
      yield { type: 'tool-call', toolCallId: 'read-1', toolName: 'storyforge.context.read', input: readInput }
      const readOutput = await request.execute('storyforge.context.read', readInput)
      yield { type: 'tool-result', toolCallId: 'read-1', toolName: 'storyforge.context.read', output: readOutput }

      const proposal = {
        target: 'chapters', mode: 'replace', recordId: 12,
        data: { content: '本次处理将保持原剧情不变，并优化语言节奏。具体修改将在下一阶段完成。'.repeat(3) },
      }
      yield { type: 'tool-call', toolCallId: 'proposal-1', toolName: 'storyforge.change.propose', input: proposal }
      await request.execute('storyforge.change.propose', proposal)
    }

    const events = await collect(createRuntime(registry, streamer).run(chapterRunInput({
      deliverableKind: 'chapter-rewrite',
      sourceTextLength: 3152,
      minLengthRatio: 0.75,
      minTextLength: 1,
    })))

    expect(events.at(-1)).toMatchObject({
      type: 'run.failed', payload: { error: expect.stringContaining('不足原文的 75%') },
    })
    expect(events.some(event => event.type === 'approval.requested')).toBe(false)
  })

  it('does not count context sources absent from the read result', async () => {
    const registry = chapterProposalRegistry({ included: [] })
    const streamer: AgentLoopStreamer = async function* (request) {
      const readInput = { sourceKeys: ['chapterOutline'] }
      yield { type: 'tool-call', toolCallId: 'read-1', toolName: 'storyforge.context.read', input: readInput }
      const readOutput = await request.execute('storyforge.context.read', readInput)
      yield { type: 'tool-result', toolCallId: 'read-1', toolName: 'storyforge.context.read', output: readOutput }

      const proposal = {
        target: 'chapters', mode: 'replace', recordId: 12,
        data: { content: '正文'.repeat(30) },
      }
      yield { type: 'tool-call', toolCallId: 'proposal-1', toolName: 'storyforge.change.propose', input: proposal }
      await request.execute('storyforge.change.propose', proposal)
    }

    const events = await collect(createRuntime(registry, streamer).run(chapterRunInput()))

    expect(events.at(-1)).toMatchObject({
      type: 'run.failed', payload: { error: expect.stringContaining('先读取上下文源 chapterOutline') },
    })
    expect(events.some(event => event.type === 'approval.requested')).toBe(false)
  })

  it('accepts required context sources that were checked but contain no data', async () => {
    const registry = chapterProposalRegistry({
      included: [], omitted: ['chapterOutline'], trimmed: [],
    })
    const streamer: AgentLoopStreamer = async function* (request) {
      const readInput = { sourceKeys: ['chapterOutline'] }
      yield { type: 'tool-call', toolCallId: 'read-1', toolName: 'storyforge.context.read', input: readInput }
      const readOutput = await request.execute('storyforge.context.read', readInput)
      yield { type: 'tool-result', toolCallId: 'read-1', toolName: 'storyforge.context.read', output: readOutput }

      const proposal = {
        target: 'chapters', mode: 'replace', recordId: 12,
        data: { content: '正文'.repeat(30) },
      }
      yield { type: 'tool-call', toolCallId: 'proposal-1', toolName: 'storyforge.change.propose', input: proposal }
      const proposalOutput = await request.execute('storyforge.change.propose', proposal)
      yield { type: 'tool-result', toolCallId: 'proposal-1', toolName: 'storyforge.change.propose', output: proposalOutput }
    }

    const events = await collect(createRuntime(registry, streamer).run(chapterRunInput()))

    expect(events.some(event => event.type === 'run.failed')).toBe(false)
    expect(events.some(event => event.type === 'approval.requested')).toBe(true)
  })

  it('rejects a chapter proposal targeting a different record', async () => {
    const registry = chapterProposalRegistry()
    const streamer: AgentLoopStreamer = async function* (request) {
      const input = {
        target: 'chapters', mode: 'replace', recordId: 99,
        data: { content: '正文'.repeat(30) },
      }
      yield { type: 'tool-call', toolCallId: 'proposal-1', toolName: 'storyforge.change.propose', input }
      await request.execute('storyforge.change.propose', input)
    }

    const events = await collect(createRuntime(registry, streamer).run(chapterRunInput({
      requiredContextSources: [],
    })))

    expect(events.at(-1)).toMatchObject({
      type: 'run.failed', payload: { error: expect.stringContaining('recordId 必须是 12') },
    })
    expect(events.some(event => event.type === 'approval.requested')).toBe(false)
  })

  it('rejects a de-ai proposal until the required safety gate passes', async () => {
    const registry = chapterProposalRegistry()
    registry.register({
      name: 'storyforge.prose.deai.inspect',
      title: '去 AI 味安全复检',
      description: 'inspect',
      inputSchema: { type: 'object' },
      risk: 'read',
      availability: 'both',
      requiredScopes: ['project:read'],
      async execute() { return { canPropose: true, blocked: false } },
    })
    const proposal = {
      target: 'chapters', mode: 'replace', recordId: 12,
      data: { content: '林砚推门进屋。'.repeat(30) },
    }
    const streamer: AgentLoopStreamer = async function* (request) {
      try {
        await request.execute('storyforge.change.propose', proposal)
        throw new Error('proposal unexpectedly passed without inspection')
      } catch (error) {
        expect(String(error)).toContain('提案前质量门尚未通过')
      }
      const inspectInput = {
        originalText: '林砚推门进屋。'.repeat(30),
        candidateText: proposal.data.content,
        protectedTerms: ['林砚'],
      }
      yield { type: 'tool-call', toolCallId: 'inspect-1', toolName: 'storyforge.prose.deai.inspect', input: inspectInput }
      const inspectOutput = await request.execute('storyforge.prose.deai.inspect', inspectInput)
      yield { type: 'tool-result', toolCallId: 'inspect-1', toolName: 'storyforge.prose.deai.inspect', output: inspectOutput }
      yield { type: 'tool-call', toolCallId: 'proposal-2', toolName: 'storyforge.change.propose', input: proposal }
      const output = await request.execute('storyforge.change.propose', proposal)
      yield { type: 'tool-result', toolCallId: 'proposal-2', toolName: 'storyforge.change.propose', output }
    }

    const events = await collect(createRuntime(registry, streamer).run(chapterRunInput({
      requiredContextSources: [],
      requiredPreProposalTools: ['storyforge.prose.deai.inspect'],
    })))

    expect(events.filter(event => event.type === 'run.failed')).toEqual([])
    expect(events.some(event => event.type === 'approval.requested')).toBe(true)
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

  it('sends prior conversation messages before the current prompt', async () => {
    const requests: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
      return sseResponse(textChunks('第二章继续山门试炼。'))
    }))

    const parts: AgentLoopPart[] = []
    for await (const part of streamAiSdkAgentLoop({
      config: {
        provider: 'custom', apiKey: 'test-key', baseUrl: 'https://example.com/v1', model: 'test-model',
      },
      instructions: 'Continue the conversation.',
      prompt: '那第二章呢？',
      conversationHistory: [
        { role: 'user', content: '第一章写了什么？' },
        { role: 'assistant', content: '第一章写了林川进入山门。' },
      ],
      descriptors: [],
      maxSteps: 1,
      signal: new AbortController().signal,
      execute: async () => ({}),
      shouldStop: () => false,
    })) parts.push(part)

    expect(requests).toHaveLength(1)
    expect(requests[0].messages).toEqual([
      { role: 'system', content: 'Continue the conversation.' },
      { role: 'user', content: '第一章写了什么？' },
      { role: 'assistant', content: '第一章写了林川进入山门。' },
      { role: 'user', content: '那第二章呢？' },
    ])
    expect(parts).toContainEqual({ type: 'text', text: '第二章继续山门试炼。' })
  })

  it('compresses earlier history at the configured model-window threshold', async () => {
    const requests: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
      return requests.length === 1
        ? completionResponse('摘要：工具读取确认林川已进入山门。')
        : sseResponse(textChunks('继续处理第二章。'))
    }))

    const parts: AgentLoopPart[] = []
    for await (const part of streamAiSdkAgentLoop({
      config: {
        provider: 'custom', apiKey: 'test-key', baseUrl: 'https://example.com/v1', model: 'test-model',
        contextWindow: 2_000, compressionThreshold: 0.8, maxTokens: 200,
      },
      instructions: 'Continue the project conversation.',
      prompt: '继续第二章',
      conversationHistory: [
        { role: 'user', content: `第一轮问题${'设定'.repeat(300)}` },
        { role: 'assistant', content: `【工具输出：storyforge.context.read】${'林川进入山门'.repeat(180)}` },
      ],
      descriptors: [],
      maxSteps: 1,
      signal: new AbortController().signal,
      execute: async () => ({}),
      shouldStop: () => false,
    })) parts.push(part)

    expect(requests).toHaveLength(2)
    expect(parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'history-compression-start' }),
      expect.objectContaining({ type: 'history-compressed', compressedMessages: 2 }),
      expect.objectContaining({ type: 'text', text: '继续处理第二章。' }),
    ]))
    expect(requests[1].messages).toEqual([
      { role: 'system', content: 'Continue the project conversation.' },
      { role: 'assistant', content: '【此前会话压缩摘要】\n摘要：工具读取确认林川已进入山门。' },
      { role: 'user', content: '继续第二章' },
    ])
  })

  it('keeps tools required and forces the proposal tool after required context is ready', async () => {
    const requests: Array<Record<string, unknown>> = []
    const responses = [
      namedToolCallChunks('storyforge_context_read', { sourceKeys: ['chapterOutline'] }, 'read-1'),
      namedToolCallChunks('storyforge_change_propose', {
        target: 'chapters', mode: 'replace', recordId: 12, data: { content: '正文'.repeat(30) },
      }, 'proposal-1'),
    ]
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
      return sseResponse(responses[requests.length - 1])
    }))
    const registry = chapterProposalRegistry()
    const contextDescriptor = registry.get('storyforge.context.read')
    const proposalDescriptor = registry.get('storyforge.change.propose')
    if (!contextDescriptor || !proposalDescriptor) throw new Error('missing chapter tool descriptors')
    const descriptors = [contextDescriptor, proposalDescriptor]
    let contextReady = false
    let proposalReady = false

    for await (const _part of streamAiSdkAgentLoop({
      config: {
        provider: 'custom', apiKey: 'test-key', baseUrl: 'https://example.com/v1', model: 'test-model',
      },
      instructions: 'Read context, then propose.',
      prompt: '写第一章',
      descriptors,
      maxSteps: 4,
      tokenBudget: 2_000,
      signal: new AbortController().signal,
      execute: async name => {
        if (name === 'storyforge.context.read') contextReady = true
        if (name === 'storyforge.change.propose') proposalReady = true
        return name === 'storyforge.change.propose'
          ? { planId: 'p', approvalId: 'a', planHash: 'h' }
          : { included: ['chapterOutline'] }
      },
      shouldStop: () => proposalReady,
      requiredContextTool: 'storyforge.context.read',
      requiredCompletionTool: 'storyforge.change.propose',
      shouldForceCompletion: () => contextReady,
    })) {
      // Consume the complete loop so the second provider request is issued.
    }

    expect(requests).toHaveLength(2)
    expect(requests[0].tool_choice).toBe('required')
    expect(requests[1].tool_choice).toEqual({
      type: 'function', function: { name: 'storyforge_change_propose' },
    })
  })

  it('uses auto with phase-limited tools for DeepSeek chat-completions compatibility', async () => {
    const requests: Array<Record<string, unknown>> = []
    const responses = [
      namedToolCallChunks('storyforge_context_read', { sourceKeys: ['chapterOutline'] }, 'read-1'),
      namedToolCallChunks('storyforge_change_propose', {
        target: 'chapters', mode: 'replace', recordId: 12, data: { content: '正文'.repeat(30) },
      }, 'proposal-1'),
    ]
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
      return sseResponse(responses[requests.length - 1])
    }))
    const registry = chapterProposalRegistry()
    const contextDescriptor = registry.get('storyforge.context.read')
    const proposalDescriptor = registry.get('storyforge.change.propose')
    if (!contextDescriptor || !proposalDescriptor) throw new Error('missing chapter tool descriptors')
    let contextReady = false
    let proposalReady = false

    for await (const _part of streamAiSdkAgentLoop({
      config: {
        provider: 'custom', apiKey: 'test-key', baseUrl: 'https://example.com/v1', model: 'DeepSeek-V4-Pro',
      },
      instructions: 'Read context, then propose.',
      prompt: '写第一章',
      descriptors: [contextDescriptor, proposalDescriptor],
      maxSteps: 4,
      tokenBudget: 2_000,
      signal: new AbortController().signal,
      execute: async name => {
        if (name === 'storyforge.context.read') contextReady = true
        if (name === 'storyforge.change.propose') proposalReady = true
        return name === 'storyforge.change.propose'
          ? { planId: 'p', approvalId: 'a', planHash: 'h' }
          : { included: ['chapterOutline'] }
      },
      shouldStop: () => proposalReady,
      requiredContextTool: 'storyforge.context.read',
      requiredCompletionTool: 'storyforge.change.propose',
      shouldForceCompletion: () => contextReady,
    })) {
      // Consume both steps.
    }

    expect(requests).toHaveLength(2)
    expect(requests.map(request => request.tool_choice)).toEqual(['auto', 'auto'])
    expect(toolNamesFromRequest(requests[0])).toEqual(['storyforge_context_read'])
    expect(toolNamesFromRequest(requests[1])).toEqual(['storyforge_change_propose'])
  })

  it('continues a DeepSeek completion contract after a text-only premature stop', async () => {
    const requests: Array<Record<string, unknown>> = []
    const responses = [
      [
        ...namedToolCallChunks('storyforge_context_read', { sourceKeys: ['chapterOutline'] }, 'read-1'),
        usageChunk(10, 5),
      ],
      [...textChunks('上下文已经齐备，接下来生成正文。'), usageChunk(5_000, 20)],
      [...namedToolCallChunks('storyforge_change_propose', {
        target: 'chapters', mode: 'replace', recordId: 12, data: { content: '正文'.repeat(30) },
      }, 'proposal-1'), usageChunk(5_100, 30)],
    ]
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
      return sseResponse(responses[requests.length - 1])
    }))
    const registry = chapterProposalRegistry()
    const contextDescriptor = registry.get('storyforge.context.read')
    const proposalDescriptor = registry.get('storyforge.change.propose')
    if (!contextDescriptor || !proposalDescriptor) throw new Error('missing chapter tool descriptors')
    let contextReady = false
    let proposalReady = false

    for await (const _part of streamAiSdkAgentLoop({
      config: {
        provider: 'custom', apiKey: 'test-key', baseUrl: 'https://example.com/v1', model: 'DeepSeek-V4-Flash',
      },
      instructions: 'Read context, then propose.',
      prompt: '写第一章',
      descriptors: [contextDescriptor, proposalDescriptor],
      maxSteps: 5,
      tokenBudget: 100,
      signal: new AbortController().signal,
      execute: async name => {
        if (name === 'storyforge.context.read') contextReady = true
        if (name === 'storyforge.change.propose') proposalReady = true
        return name === 'storyforge.change.propose'
          ? { planId: 'p', approvalId: 'a', planHash: 'h' }
          : { included: ['chapterOutline'] }
      },
      shouldStop: () => proposalReady,
      requiredContextTool: 'storyforge.context.read',
      requiredCompletionTool: 'storyforge.change.propose',
      requiredCompletionReminder: '提案参数必须为 target=characters，mode=add；必填字段：name、roleWeight、moralAxis、orderAxis。',
      shouldForceCompletion: () => contextReady,
    })) {
      // Consume the continuation round after the text-only model response.
    }

    expect(requests).toHaveLength(3)
    expect(requests.map(request => request.tool_choice)).toEqual(['auto', 'auto', 'auto'])
    expect(toolNamesFromRequest(requests[2])).toEqual(['storyforge_change_propose'])
    expect(JSON.stringify(requests[2].messages)).toContain('宿主完成契约尚未满足')
    expect(JSON.stringify(requests[2].messages)).toContain('接下来生成正文')
    expect(JSON.stringify(requests[2].messages)).toContain('target=characters')
  })
})

function toolNamesFromRequest(request: Record<string, unknown>): string[] {
  const tools = Array.isArray(request.tools) ? request.tools : []
  return tools.map(tool => {
    const fn = Reflect.get(tool as object, 'function') as Record<string, unknown> | undefined
    return typeof fn?.name === 'string' ? fn.name : ''
  }).filter(Boolean)
}

function createRuntime(
  registry: ToolRegistry,
  streamer: AgentLoopStreamer,
  discardPlan?: (planId: string) => void,
) {
  return new AiSdkAgentRuntimeAdapter({
    getModelConfig: () => ({
      provider: 'test', apiKey: '', baseUrl: 'http://localhost/v1', model: 'test-model',
    }),
    createToolRegistry: async () => registry,
    platform: 'web',
    grantedScopes: ['project:read'],
    streamer,
    discardPlan,
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

function chapterProposalRegistry(contextOutput?: unknown): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register({
    name: 'storyforge.context.read',
    title: '读取项目设定',
    description: 'context',
    inputSchema: { type: 'object' },
    risk: 'read',
    availability: 'both',
    requiredScopes: ['project:read'],
    async execute(_context, input) {
      return contextOutput ?? { included: (input as { sourceKeys?: string[] }).sourceKeys ?? [] }
    },
  })
  registry.register({
    name: 'storyforge.change.propose',
    title: '生成变更方案',
    description: 'proposal',
    inputSchema: { type: 'object' },
    risk: 'write',
    availability: 'both',
    requiredScopes: ['project:read'],
    async execute(_context, input) {
      return {
        planId: 'chapter-plan', approvalId: 'chapter-approval', planHash: 'chapter-hash',
        input,
        preview: { target: 'chapters', itemCount: 1, canonicalFields: ['content'] },
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

function chapterRunInput(overrides: {
  requiredContextSources?: string[]
  requiredPreProposalTools?: string[]
  deliverableKind?: 'chapter-draft' | 'chapter-rewrite'
  sourceTextLength?: number
  minLengthRatio?: number
  minTextLength?: number
} = {}) {
  return {
    ...runInput(),
    scope: { module: 'editor', chapterId: 12, outlineNodeId: 11 },
    userMessage: '写第一章',
    completionRequirement: {
      kind: 'change-proposal' as const,
      target: 'chapters',
      mode: 'replace' as const,
      recordId: 12,
      requiredFields: ['content'],
      minTextLength: { content: overrides.minTextLength ?? 20 },
      requiredContextSources: overrides.requiredContextSources ?? ['chapterOutline'],
      requiredPreProposalTools: overrides.requiredPreProposalTools,
      deliverableKind: overrides.deliverableKind ?? 'chapter-draft',
      sourceTextLength: overrides.sourceTextLength,
      minLengthRatio: overrides.minLengthRatio,
    },
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

function completionResponse(text: string): Response {
  return new Response(JSON.stringify({
    id: 'chatcmpl-summary', object: 'chat.completion', created: 1, model: 'test-model',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
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

function namedToolCallChunks(
  name: string,
  args: Record<string, unknown>,
  id: string,
): Record<string, unknown>[] {
  return [
    completionChunk({
      role: 'assistant',
      tool_calls: [{
        index: 0,
        id,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      }],
    }, null),
    completionChunk({}, 'tool_calls'),
  ]
}

function textChunks(text: string): Record<string, unknown>[] {
  return [completionChunk({ role: 'assistant', content: text }, null), completionChunk({}, 'stop')]
}

function usageChunk(inputTokens: number, outputTokens: number): Record<string, unknown> {
  return {
    id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'test-model',
    choices: [],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  }
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
