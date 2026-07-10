import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { ToolRegistry } from '../../src/lib/agent/tools/tool-registry'
import type { AgentEvent } from '../../src/lib/agent/events/agent-events'
import type {
  AgentRunInput,
  AgentRuntimePort,
  AgentScope,
  ApprovalDecision,
} from '../../src/lib/agent/runtime/agent-runtime-port'
import type {
  Actor,
  ApprovalReference,
  StoryForgeTool,
  ToolExecutionContext,
  ToolScope,
} from '../../src/lib/agent/tools/tool-types'

function createContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    runId: 'run-1',
    conversationId: 'conversation-1',
    sessionId: 'session-1',
    project: { backend: 'dexie', projectId: 1 },
    platform: 'web',
    scopes: new Set<ToolScope>(['project:read']),
    signal: new AbortController().signal,
    actor: { id: 'user-1', kind: 'user' },
    ...overrides,
  }
}

function createTool(
  overrides: Partial<StoryForgeTool<{ value: string }, string>> = {},
): StoryForgeTool<{ value: string }, string> {
  return {
    name: 'storyforge.test.read',
    title: '测试读取',
    description: '测试工具',
    inputSchema: { type: 'object' },
    risk: 'read',
    availability: 'both',
    requiredScopes: ['project:read'],
    execute: vi.fn(async (_context, input) => input.value),
    ...overrides,
  }
}

describe('ToolRegistry', () => {
  it('注册工具、暴露不可变 descriptor 并拒绝重复名称', () => {
    const registry = new ToolRegistry()
    const tool = createTool()

    registry.register(tool)

    const descriptor = registry.get(tool.name)
    expect(descriptor).toMatchObject({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      risk: tool.risk,
      availability: tool.availability,
    })
    expect(descriptor).not.toBe(tool)
    expect(registry.listAvailable(createContext())).toEqual([descriptor])
    expect(() => registry.register(tool)).toThrow('duplicate tool storyforge.test.read')
  })

  it('listAvailable：scope 完全满足但平台错误时仍不可用', () => {
    const registry = new ToolRegistry()
    registry.register(createTool({
      name: 'storyforge.desktop.write',
      availability: 'desktop',
      risk: 'write',
      requiredScopes: ['project:write'],
    }))

    expect(registry.listAvailable(createContext({
      scopes: new Set<ToolScope>(['project:write']),
    }))).toEqual([])
  })

  it('execute：scope 完全满足但平台错误时拒绝执行', async () => {
    const registry = new ToolRegistry()
    const execute = vi.fn(async () => 'must-not-run')
    registry.register(createTool({
      name: 'storyforge.desktop.write',
      availability: 'desktop',
      risk: 'write',
      requiredScopes: ['project:write'],
      execute,
    }))

    await expect(registry.execute(
      'storyforge.desktop.write',
      createContext({
        scopes: new Set<ToolScope>(['project:write']),
      }),
      { value: 'blocked' },
    )).rejects.toThrow('tool storyforge.desktop.write is not available')
    expect(execute).not.toHaveBeenCalled()
  })

  it('listAvailable：平台正确但缺少唯一 required scope 时不可用', () => {
    const registry = new ToolRegistry()
    registry.register(createTool({
      name: 'storyforge.desktop.write',
      availability: 'desktop',
      risk: 'write',
      requiredScopes: ['project:write'],
    }))

    expect(registry.listAvailable(createContext({
      platform: 'desktop',
      scopes: new Set<ToolScope>(),
    }))).toEqual([])
  })

  it('execute：平台正确但缺少唯一 required scope 时拒绝执行', async () => {
    const registry = new ToolRegistry()
    const execute = vi.fn(async () => 'must-not-run')
    registry.register(createTool({
      name: 'storyforge.desktop.write',
      availability: 'desktop',
      risk: 'write',
      requiredScopes: ['project:write'],
      execute,
    }))

    await expect(registry.execute(
      'storyforge.desktop.write',
      createContext({
        platform: 'desktop',
        scopes: new Set<ToolScope>(),
      }),
      { value: 'blocked' },
    )).rejects.toThrow('tool storyforge.desktop.write is not available')
    expect(execute).not.toHaveBeenCalled()
  })

  it('listAvailable：多 scope 只缺一个时不可用', () => {
    const registry = new ToolRegistry()
    registry.register(createTool({
      name: 'storyforge.multi-scope',
      requiredScopes: ['project:read', 'project:write'],
    }))

    expect(registry.listAvailable(createContext({
      scopes: new Set<ToolScope>(['project:read']),
    }))).toEqual([])
  })

  it('execute：多 scope 只缺一个时拒绝执行', async () => {
    const registry = new ToolRegistry()
    const execute = vi.fn(async () => 'must-not-run')
    registry.register(createTool({
      name: 'storyforge.multi-scope',
      requiredScopes: ['project:read', 'project:write'],
      execute,
    }))

    await expect(registry.execute(
      'storyforge.multi-scope',
      createContext({
        scopes: new Set<ToolScope>(['project:read']),
      }),
      { value: 'blocked' },
    )).rejects.toThrow('tool storyforge.multi-scope is not available')
    expect(execute).not.toHaveBeenCalled()
  })

  it('在平台与全部 scope 均满足时执行工具', async () => {
    const registry = new ToolRegistry()
    const execute = vi.fn(async () => 'written')
    registry.register(createTool({
      name: 'storyforge.desktop.write',
      availability: 'desktop',
      risk: 'write',
      requiredScopes: ['project:read', 'project:write'],
      execute,
    }))

    await expect(registry.execute(
      'storyforge.desktop.write',
      createContext({
        platform: 'desktop',
        scopes: new Set<ToolScope>(['project:read', 'project:write']),
      }),
      { value: 'write-me' },
    )).resolves.toBe('written')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('将原始 context 与 input 透传给 execute', async () => {
    const registry = new ToolRegistry()
    const execute = vi.fn(async () => ({ ok: true }))
    const tool: StoryForgeTool<{ nested: { value: string } }, { ok: boolean }> = {
      name: 'storyforge.test.nested',
      title: '嵌套输入',
      description: '验证输入透传',
      inputSchema: { type: 'object' },
      risk: 'read',
      availability: 'both',
      requiredScopes: ['project:read'],
      execute,
    }
    const context = createContext()
    const input = { nested: { value: 'unchanged' } }
    registry.register(tool)

    await registry.execute(tool.name, context, input)

    expect(execute).toHaveBeenCalledWith(context, input)
    expect(execute.mock.calls[0]?.[0]).toBe(context)
    expect(execute.mock.calls[0]?.[1]).toBe(input)
  })

  it('拒绝未知工具', async () => {
    const registry = new ToolRegistry()

    await expect(registry.execute('storyforge.missing', createContext(), {}))
      .rejects.toThrow('unknown tool storyforge.missing')
  })

  it('signal 已 abort 时抛出 AbortError 且不执行工具', async () => {
    const registry = new ToolRegistry()
    const execute = vi.fn(async () => 'must-not-run')
    const tool = createTool({ execute })
    registry.register(tool)
    const controller = new AbortController()
    controller.abort()

    const error = await registry.execute(tool.name, createContext({ signal: controller.signal }), {})
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('AbortError')
    expect(execute).not.toHaveBeenCalled()
  })

  it('注册后篡改原工具不会改变不可变 descriptor、授权或 executor', async () => {
    const registry = new ToolRegistry()
    const originalExecute = vi.fn(async () => 'original')
    const replacementExecute = vi.fn(async () => 'replacement')
    const originalSummarizeInput = vi.fn((input: { value: string }) => `input:${input.value}`)
    const replacementSummarizeInput = vi.fn((input: { value: string }) => `replacement:${input.value}`)
    const originalSummarizeOutput = vi.fn((output: string) => `output:${output}`)
    const replacementSummarizeOutput = vi.fn((output: string) => `replacement:${output}`)
    const requiredScopes: ToolScope[] = ['project:write', 'manuscript:write']
    const inputSchema = {
      type: 'object',
      properties: {
        value: { type: 'string', description: '注册时描述' },
      },
    }
    const tool = createTool({
      name: 'storyforge.snapshot.write',
      risk: 'write',
      availability: 'desktop',
      requiredScopes,
      inputSchema,
      execute: originalExecute,
      summarizeInput: originalSummarizeInput,
      summarizeOutput: originalSummarizeOutput,
    })
    registry.register(tool)

    const descriptor = registry.get('storyforge.snapshot.write')
    if (!descriptor) throw new Error('注册后的 descriptor 不存在')
    const descriptorSchema = descriptor.inputSchema as {
      properties: { value: { description: string } }
    }

    Reflect.set(requiredScopes, 'length', 0)
    Reflect.set(tool, 'name', 'storyforge.mutated.name')
    Reflect.set(tool, 'availability', 'web')
    Reflect.set(tool, 'requiredScopes', [])
    Reflect.set(tool, 'risk', 'read')
    Reflect.set(tool, 'execute', replacementExecute)
    Reflect.set(tool, 'summarizeInput', replacementSummarizeInput)
    Reflect.set(tool, 'summarizeOutput', replacementSummarizeOutput)
    Reflect.set(inputSchema.properties.value, 'description', '篡改后的描述')

    expect(descriptor).toMatchObject({
      name: 'storyforge.snapshot.write',
      risk: 'write',
      availability: 'desktop',
      requiredScopes: ['project:write', 'manuscript:write'],
    })
    expect(descriptorSchema.properties.value.description).toBe('注册时描述')
    expect(Object.isFrozen(descriptor)).toBe(true)
    expect(Object.isFrozen(descriptor.requiredScopes)).toBe(true)
    expect(Object.isFrozen(descriptor.inputSchema)).toBe(true)
    expect(Object.isFrozen(descriptorSchema.properties)).toBe(true)
    expect(Object.isFrozen(descriptorSchema.properties.value)).toBe(true)
    expect(Reflect.set(descriptor, 'risk', 'read')).toBe(false)
    expect(Reflect.set(descriptor.requiredScopes, 0, 'project:read')).toBe(false)
    expect(Reflect.set(descriptorSchema.properties.value, 'description', '再次篡改')).toBe(false)
    expect(descriptor.risk).toBe('write')
    expect(descriptor.requiredScopes).toEqual(['project:write', 'manuscript:write'])
    expect(descriptorSchema.properties.value.description).toBe('注册时描述')
    expect(descriptor.summarizeInput?.({ value: 'allowed' })).toBe('input:allowed')
    expect(descriptor.summarizeOutput?.('original')).toBe('output:original')
    expect(replacementSummarizeInput).not.toHaveBeenCalled()
    expect(replacementSummarizeOutput).not.toHaveBeenCalled()

    const bypassContext = createContext({
      platform: 'web',
      scopes: new Set<ToolScope>(),
    })
    expect(registry.listAvailable(bypassContext)).toEqual([])
    await expect(registry.execute(descriptor.name, bypassContext, { value: 'blocked' }))
      .rejects.toThrow('tool storyforge.snapshot.write is not available')
    expect(originalExecute).not.toHaveBeenCalled()
    expect(replacementExecute).not.toHaveBeenCalled()

    const authorizedContext = createContext({
      platform: 'desktop',
      scopes: new Set<ToolScope>(['project:write', 'manuscript:write']),
    })
    expect(registry.listAvailable(authorizedContext)).toEqual([descriptor])
    await expect(registry.execute(descriptor.name, authorizedContext, { value: 'allowed' }))
      .resolves.toBe('original')
    expect(originalExecute).toHaveBeenCalledOnce()
    expect(replacementExecute).not.toHaveBeenCalled()
  })

  it('通过普通函数调用执行注册时捕获的 executor，使 this 为 undefined', async () => {
    const registry = new ToolRegistry()
    const execute: StoryForgeTool<{ value: string }, string>['execute'] = function (
      this: void,
      _context,
      input,
    ) {
      return Promise.resolve(`${input.value}:${this === undefined ? 'undefined' : 'bound'}`)
    }
    const tool = createTool({ execute })
    registry.register(tool)

    await expect(registry.execute(tool.name, createContext(), { value: 'ok' }))
      .resolves.toBe('ok:undefined')
  })

  it('锁定只读工具元数据与动态 execute 的 unknown 返回契约', () => {
    type ToolMetadata = Pick<
      StoryForgeTool,
      'name' | 'title' | 'description' | 'inputSchema' | 'risk' | 'availability' | 'requiredScopes'
    >

    expectTypeOf<ToolMetadata>().toEqualTypeOf<Readonly<ToolMetadata>>()
    expectTypeOf<StoryForgeTool['requiredScopes']>().toEqualTypeOf<readonly ToolScope[]>()
    expectTypeOf<ToolRegistry['execute']>().toEqualTypeOf<
      (
        name: string,
        context: ToolExecutionContext,
        input: unknown,
      ) => Promise<unknown>
    >()
    expectTypeOf<ReturnType<ToolRegistry['execute']>>().toEqualTypeOf<Promise<unknown>>()
    expectTypeOf<ReturnType<ToolRegistry['execute']>>().not.toEqualTypeOf<Promise<Date>>()
  })

  it('工具类型包含会话、作用域、actor 与 approval 元数据', () => {
    const actor: Actor = { id: 'background-1', kind: 'background-agent' }
    const approval: ApprovalReference = { approvalId: 'approval-1', planHash: 'sha256:plan' }
    const context: ToolExecutionContext = createContext({
      actor,
      approval,
      worldGroupId: 2,
      outlineNodeId: 3,
      chapterId: 4,
    })

    expectTypeOf<ToolScope>().toEqualTypeOf<
      'project:read' | 'project:write' | 'manuscript:write' | 'external:read' | 'external:write'
    >()
    expectTypeOf<Actor['kind']>().toEqualTypeOf<'user' | 'background-agent' | 'system'>()
    expectTypeOf<StoryForgeTool<{ value: string }, string>['execute']>().toEqualTypeOf<
      (this: void, context: ToolExecutionContext, input: { value: string }) => Promise<string>
    >()
    expect(context.sessionId).toBe('session-1')
    expect(context.approval).toEqual(approval)
  })

  it('锁定 runtime port 的输入与返回类型', () => {
    const scope: AgentScope = { chapterId: 4, selection: { text: '选中的章节文本' } }
    const input: AgentRunInput = {
      conversationId: 'conversation-1',
      project: { backend: 'dexie', projectId: 1 },
      scope,
      userMessage: '请润色选中的章节',
    }
    const decision: ApprovalDecision = { approvalId: 'approval-1', decision: 'approved' }

    expect(input.scope).toBe(scope)
    expect(decision.decision).toBe('approved')
    expectTypeOf<AgentRuntimePort['run']>().toEqualTypeOf<
      (input: AgentRunInput) => AsyncIterable<AgentEvent>
    >()
    expectTypeOf<AgentRuntimePort['resume']>().toEqualTypeOf<
      (runId: string, decision?: ApprovalDecision) => AsyncIterable<AgentEvent>
    >()
    expectTypeOf<AgentRuntimePort['cancel']>().toEqualTypeOf<
      (runId: string) => Promise<void>
    >()
  })
})
