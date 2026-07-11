import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { StoryForgeTool } from '../tools/tool-types'
import { APP_VERSION } from '../../version'

export type McpTransportKind = 'streamable-http' | 'sse'

export interface McpServerConfig {
  readonly id: string
  readonly name: string
  readonly url: string
  readonly enabled: boolean
  readonly allowWrite: boolean
  readonly transport?: McpTransportKind
  readonly headers?: Readonly<Record<string, string>>
}

export interface McpToolDefinition {
  readonly name: string
  readonly description?: string
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly annotations?: {
    readonly title?: string
    readonly readOnlyHint?: boolean
    readonly destructiveHint?: boolean
  }
}

export interface McpCallResult {
  readonly content?: readonly unknown[]
  readonly structuredContent?: unknown
  readonly isError?: boolean
  readonly [key: string]: unknown
}

export interface McpClientPort {
  listTools(signal?: AbortSignal): Promise<readonly McpToolDefinition[]>
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult>
  close(): Promise<void>
}

export type McpClientFactory = (config: McpServerConfig) => Promise<McpClientPort>

export interface McpLoadResult {
  readonly tools: readonly StoryForgeTool[]
  readonly errors: readonly { serverId: string; message: string }[]
}

export class McpToolProvider {
  readonly #clients = new Map<string, { fingerprint: string; client: McpClientPort }>()

  constructor(private readonly createClient: McpClientFactory = createHttpMcpClient) {}

  async load(configs: readonly McpServerConfig[], signal?: AbortSignal): Promise<McpLoadResult> {
    const tools: StoryForgeTool[] = []
    const errors: Array<{ serverId: string; message: string }> = []
    const enabledIds = new Set(configs.filter(config => config.enabled).map(config => config.id))
    await this.closeMissing(enabledIds)

    for (const config of configs) {
      if (!config.enabled) continue
      try {
        const client = await this.clientFor(config)
        const definitions = await client.listTools(signal)
        for (const definition of definitions) {
          if (!definition.annotations?.readOnlyHint && !config.allowWrite) continue
          tools.push(createMcpTool(config, definition, client))
        }
      } catch (error) {
        errors.push({ serverId: config.id, message: errorMessage(error) })
      }
    }

    return { tools, errors }
  }

  async close(): Promise<void> {
    await Promise.allSettled(Array.from(this.#clients.values(), entry => entry.client.close()))
    this.#clients.clear()
  }

  private async clientFor(config: McpServerConfig): Promise<McpClientPort> {
    const fingerprint = configFingerprint(config)
    const cached = this.#clients.get(config.id)
    if (cached?.fingerprint === fingerprint) return cached.client
    if (cached) await cached.client.close()
    const client = await this.createClient(config)
    this.#clients.set(config.id, { fingerprint, client })
    return client
  }

  private async closeMissing(enabledIds: ReadonlySet<string>): Promise<void> {
    for (const [id, entry] of this.#clients) {
      if (enabledIds.has(id)) continue
      await entry.client.close()
      this.#clients.delete(id)
    }
  }
}

async function createHttpMcpClient(config: McpServerConfig): Promise<McpClientPort> {
  const client = new Client({ name: 'storyforge', version: APP_VERSION.replace(/^v/, '') }, { capabilities: {} })
  const requestInit = config.headers ? { headers: { ...config.headers } } : undefined
  const transport = config.transport === 'sse'
    ? new SSEClientTransport(new URL(config.url), { requestInit })
    : new StreamableHTTPClientTransport(new URL(config.url), { requestInit })
  await client.connect(transport)

  return {
    async listTools(signal) {
      const result = await client.listTools(undefined, { signal })
      return result.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      }))
    },
    async callTool(name, args, signal) {
      return await client.callTool({ name, arguments: args }, undefined, { signal }) as McpCallResult
    },
    async close() {
      await client.close()
    },
  }
}

function createMcpTool(
  server: McpServerConfig,
  definition: McpToolDefinition,
  client: McpClientPort,
): StoryForgeTool<Record<string, unknown>, unknown> {
  const readOnly = definition.annotations?.readOnlyHint === true
  const title = definition.annotations?.title || definition.name
  return {
    name: `mcp.${safeSegment(server.id)}.${definition.name}`,
    title: `${server.name} / ${title}`,
    description: definition.description || `调用 ${server.name} 的 MCP 工具 ${definition.name}`,
    inputSchema: definition.inputSchema,
    risk: 'external',
    availability: 'both',
    requiredScopes: [readOnly ? 'external:read' : 'external:write'],
    summarizeInput: () => `调用 ${server.name}：${title}`,
    summarizeOutput: output => summarizeMcpOutput(title, output),
    async execute(context, input) {
      const result = await client.callTool(definition.name, input, context.signal)
      if (result.isError) throw new Error(extractMcpText(result) || `${title} 执行失败`)
      return result.structuredContent ?? { content: result.content ?? [] }
    },
  }
}

function summarizeMcpOutput(title: string, output: unknown): string {
  const text = extractMcpText(output)
  return text ? `${title}：${text.slice(0, 80)}` : `${title} 已完成`
}

function extractMcpText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const content = Reflect.get(value, 'content')
  if (!Array.isArray(content)) return ''
  return content
    .map(item => item && typeof item === 'object' && Reflect.get(item, 'type') === 'text'
      ? Reflect.get(item, 'text')
      : '')
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .join('\n')
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_') || 'server'
}

function configFingerprint(config: McpServerConfig): string {
  return JSON.stringify({
    url: config.url,
    transport: config.transport ?? 'streamable-http',
    headers: config.headers ?? {},
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
