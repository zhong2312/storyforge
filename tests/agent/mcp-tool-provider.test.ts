import { describe, expect, it, vi } from 'vitest'
import { McpToolProvider, type McpClientPort, type McpServerConfig } from '../../src/lib/agent/mcp'
import { ToolRegistry } from '../../src/lib/agent/tools/tool-registry'
import type { ToolExecutionContext, ToolScope } from '../../src/lib/agent/tools/tool-types'

describe('McpToolProvider', () => {
  it('maps MCP tools into external StoryForge tools and preserves schemas', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: '搜索完成' }] }))
    const client = fakeClient(callTool)
    const provider = new McpToolProvider(async () => client)

    const result = await provider.load([serverConfig()])

    expect(result.errors).toEqual([])
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0]).toMatchObject({
      name: 'mcp.docs.search',
      risk: 'external',
      requiredScopes: ['external:read'],
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    })
    const registry = new ToolRegistry()
    registry.register(result.tools[0])
    const output = await registry.execute(
      'mcp.docs.search',
      context(['external:read']),
      { query: '世界观' },
    )
    expect(callTool).toHaveBeenCalledWith('search', { query: '世界观' }, expect.any(AbortSignal))
    expect(output).toEqual({ content: [{ type: 'text', text: '搜索完成' }] })
  })

  it('hides non-read-only MCP tools until the server is explicitly allowed to write', async () => {
    const client: McpClientPort = {
      async listTools() {
        return [{
          name: 'publish',
          inputSchema: { type: 'object' },
          annotations: { destructiveHint: true },
        }]
      },
      async callTool() { return {} },
      async close() {},
    }
    const provider = new McpToolProvider(async () => client)

    expect((await provider.load([serverConfig()])).tools).toHaveLength(0)
    const allowed = await provider.load([{ ...serverConfig(), allowWrite: true }])
    expect(allowed.tools[0].requiredScopes).toEqual(['external:write'])
  })

  it('isolates connection failures and reuses unchanged clients', async () => {
    const create = vi.fn(async (config: McpServerConfig) => {
      if (config.id === 'bad') throw new Error('connection failed')
      return fakeClient(async () => ({}))
    })
    const provider = new McpToolProvider(create)
    const configs = [serverConfig(), { ...serverConfig(), id: 'bad', name: 'Bad' }]

    const first = await provider.load(configs)
    const second = await provider.load(configs)

    expect(first.tools).toHaveLength(1)
    expect(first.errors).toEqual([{ serverId: 'bad', message: 'connection failed' }])
    expect(second.tools).toHaveLength(1)
    expect(create).toHaveBeenCalledTimes(3)
  })
})

function fakeClient(callTool: McpClientPort['callTool']): McpClientPort {
  return {
    async listTools() {
      return [{
        name: 'search',
        description: '搜索文档',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        annotations: { title: '搜索', readOnlyHint: true },
      }]
    },
    callTool,
    async close() {},
  }
}

function serverConfig(): McpServerConfig {
  return {
    id: 'docs',
    name: '文档服务',
    url: 'https://example.com/mcp',
    enabled: true,
    allowWrite: false,
    transport: 'streamable-http',
  }
}

function context(scopes: ToolScope[]): ToolExecutionContext {
  return {
    runId: 'run-1',
    conversationId: 'conversation-1',
    sessionId: 'session-1',
    project: { backend: 'dexie', projectId: 1 },
    platform: 'web',
    scopes: new Set(scopes),
    signal: new AbortController().signal,
    actor: { id: 'user-1', kind: 'user' },
  }
}
