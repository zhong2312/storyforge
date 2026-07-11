import { nanoid } from 'nanoid'
import type { McpServerConfig, McpTransportKind } from './mcp-tool-provider'

const STORAGE_KEY = 'storyforge-mcp-servers'

export function loadMcpServerConfigs(): McpServerConfig[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(value)) return []
    return value.flatMap(parseServerConfig)
  } catch {
    return []
  }
}

export function saveMcpServerConfigs(configs: readonly McpServerConfig[]): void {
  const safe = configs.map(({ headers: _headers, ...config }) => config)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe))
}

export function createMcpServerConfig(input: {
  name: string
  url: string
  transport?: McpTransportKind
}): McpServerConfig {
  return {
    id: nanoid(10),
    name: input.name.trim() || 'MCP Server',
    url: input.url.trim(),
    enabled: true,
    allowWrite: false,
    transport: input.transport ?? 'streamable-http',
  }
}

function parseServerConfig(value: unknown): McpServerConfig[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string'
    || typeof record.name !== 'string'
    || typeof record.url !== 'string') return []
  const transport = record.transport === 'sse' ? 'sse' : 'streamable-http'
  return [{
    id: record.id,
    name: record.name,
    url: record.url,
    enabled: record.enabled !== false,
    allowWrite: record.allowWrite === true,
    transport,
  }]
}
