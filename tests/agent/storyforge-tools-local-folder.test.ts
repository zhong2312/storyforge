import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { ToolRegistry } from '../../src/lib/agent/tools/tool-registry'
import { createStoryForgeTools } from '../../src/lib/agent/tools/internal'
import { LocalFolderProjectStorage } from '../../src/lib/storage/adapters/local-folder'
import type { ProjectFileSystemPort } from '../../src/lib/storage/ports'
import type { ToolExecutionContext, ToolScope } from '../../src/lib/agent/tools/tool-types'

class MemoryProjectFileSystem implements ProjectFileSystemPort {
  readonly capabilities = { atomicWrite: true, watch: false, localPaths: true }
  readonly files = new Map<string, string>()

  async readText(path: string): Promise<string> {
    const value = this.files.get(path)
    if (value == null) throw new DOMException('missing', 'NotFoundError')
    return value
  }

  async writeTextAtomic(path: string, content: string): Promise<void> {
    this.files.set(path, content)
  }

  async exists(path: string): Promise<boolean> { return this.files.has(path) }
  async remove(path: string): Promise<void> { this.files.delete(path) }
}

const locator = {
  backend: 'local-folder' as const,
  projectUuid: 'agent-folder-project',
  projectPath: 'F:/novels/agent-folder-project',
}

describe('StoryForge tools with local-folder storage', () => {
  afterEach(async () => {
    await db.delete()
  })

  it('reads and commits registry data without falling back to Dexie', async () => {
    const fileSystem = new MemoryProjectFileSystem()
    const storage = new LocalFolderProjectStorage(locator, fileSystem)
    await storage.table('projects').add({ id: 41, name: '文件项目', updatedAt: 100 })
    await storage.table('worldviews').add({
      projectId: 41,
      worldGroupId: null,
      worldOrigin: '星河从本地文件中苏醒',
      createdAt: 100,
      updatedAt: 100,
    })
    await storage.table('characters').add({
      projectId: 41,
      name: '陆昭',
      role: 'supporting',
      ending: '在星河尽头守望故乡',
      createdAt: 100,
      updatedAt: 100,
    })
    await storage.table('worldRulesProfiles').add({
      projectId: 41,
      worldGroupId: null,
      entries: {
        'era.period': {
          historicalAnchors: '旧历法',
          fictionalAdaptations: '',
          priority: 'historical',
        },
      },
      customNodes: [],
      globalNote: '',
      createdAt: 100,
      updatedAt: 100,
    })
    const registry = new ToolRegistry()
    for (const tool of createStoryForgeTools({ storage })) registry.register(tool)

    const read = await registry.execute(
      'storyforge.context.read',
      context(['project:read']),
      { sourceKeys: ['worldview'] },
    ) as { text: string; included: string[] }

    expect(read.included).toContain('worldview')
    expect(read.text).toContain('星河从本地文件中苏醒')

    const rag = await registry.execute(
      'storyforge.rag.search',
      context(['project:read']),
      { query: '谁在星河尽头守望', sourceTables: ['characters'] },
    ) as { hitCount: number; text: string }
    expect(rag.hitCount).toBeGreaterThan(0)
    expect(rag.text).toContain('陆昭')
    expect(rag.text).toContain('星河尽头守望故乡')

    const plan = await registry.execute(
      'storyforge.change.propose',
      context(['project:read']),
      { target: 'worldviews', mode: 'replace', data: { worldOrigin: '星河已被重新锻造' } },
    ) as { planId: string; approvalId: string; planHash: string }

    await registry.execute(
      'storyforge.change.commit',
      context(['project:write'], { approval: { approvalId: plan.approvalId, planHash: plan.planHash } }),
      { planId: plan.planId },
    )

    expect(await storage.table('worldviews').findOne({ where: { projectId: 41 } }))
      .toMatchObject({ worldOrigin: '星河已被重新锻造' })
    expect(await db.worldviews.count()).toBe(0)
    expect(fileSystem.files.get('.storyforge/project-store.json')).toContain('星河已被重新锻造')

    const rulesPlan = await registry.execute(
      'storyforge.change.propose',
      context(['project:read']),
      {
        target: 'worldRulesProfiles',
        mode: 'replace',
        data: {
          entries: {
            era: {
              historicalAnchors: '参考唐制',
              fictionalAdaptations: '增设星官署',
              priority: 'balanced',
            },
          },
        },
      },
    ) as { planId: string; approvalId: string; planHash: string }
    await registry.execute(
      'storyforge.change.commit',
      context(['project:write'], { approval: { approvalId: rulesPlan.approvalId, planHash: rulesPlan.planHash } }),
      { planId: rulesPlan.planId },
    )
    const rules = await storage.table<{
      projectId: number
      entries: Record<string, { historicalAnchors: string }>
    }>('worldRulesProfiles').findOne({ where: { projectId: 41 } })
    expect(rules?.entries['era.period'].historicalAnchors).toBe('旧历法')
    expect(rules?.entries.era.historicalAnchors).toBe('参考唐制')
    await storage.close()
  })
})

function context(
  scopes: ToolScope[],
  overrides: Partial<ToolExecutionContext> = {},
): ToolExecutionContext {
  return {
    runId: 'run-local',
    conversationId: 'conversation-local',
    sessionId: 'session-local',
    project: locator,
    platform: 'web',
    scopes: new Set(scopes),
    signal: new AbortController().signal,
    actor: { id: 'user-1', kind: 'user' },
    worldGroupId: null,
    ...overrides,
  }
}
