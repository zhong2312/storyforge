import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { ToolRegistry } from '../../src/lib/agent/tools/tool-registry'
import { createStoryForgeTools } from '../../src/lib/agent/tools/internal'
import { DexieProjectStorage } from '../../src/lib/storage/adapters/dexie'
import type { ToolExecutionContext, ToolScope } from '../../src/lib/agent/tools/tool-types'

describe('registry-driven StoryForge tools', () => {
  let storage: DexieProjectStorage
  let registry: ToolRegistry

  beforeEach(async () => {
    await db.delete()
    await db.open()
    await db.projects.add({
      id: 1,
      name: 'Agent Tool Test',
      genre: 'other',
      genres: ['other'],
      status: 'drafting',
      description: '',
      targetWordCount: 100_000,
      createdAt: 100,
      updatedAt: 100,
    })
    storage = new DexieProjectStorage({ backend: 'dexie', projectId: 1 })
    registry = new ToolRegistry()
    for (const tool of createStoryForgeTools({ storage })) registry.register(tool)
  })

  afterEach(async () => {
    await storage.close()
    await db.delete()
  })

  it('exposes immutable descriptors for the four generic registry tools', () => {
    expect(registry.listAvailable(context(['project:read'])).map(tool => tool.name)).toEqual([
      'storyforge.settings.catalog',
      'storyforge.context.read',
      'storyforge.change.propose',
    ])
    expect(registry.get('storyforge.change.commit')?.requiredScopes).toEqual(['project:write'])
  })

  it('catalog derives readable sources and writable settings from registries', async () => {
    const output = await registry.execute(
      'storyforge.settings.catalog',
      context(['project:read']),
      {},
    ) as {
      readSources: Array<{ key: string }>
      writeTargets: Array<{ target: string; fields: Array<{ field: string }> }>
    }

    expect(output.readSources.some(source => source.key === 'worldview')).toBe(true)
    expect(output.writeTargets.find(target => target.target === 'worldviews')?.fields)
      .toContainEqual(expect.objectContaining({ field: 'worldOrigin' }))
  })

  it('context.read delegates to CONTEXT_SOURCES and assembleContext', async () => {
    await db.worldviews.add({
      projectId: 1,
      geography: '',
      history: '',
      society: '',
      culture: '',
      economy: '',
      rules: '',
      summary: '',
      worldOrigin: '天地由九重炉火锻成',
      worldGroupId: null,
      createdAt: 100,
      updatedAt: 100,
    } as never)

    const output = await registry.execute(
      'storyforge.context.read',
      context(['project:read']),
      { sourceKeys: ['worldview'] },
    ) as { text: string; included: string[] }

    expect(output.included).toContain('worldview')
    expect(output.text).toContain('天地由九重炉火锻成')
  })

  it('proposes an alias-aware plan without writing, then commits only with matching approval', async () => {
    const plan = await registry.execute(
      'storyforge.change.propose',
      context(['project:read']),
      {
        target: 'worldviews',
        mode: 'replace',
        data: { summary: '炉火创世', ignored: 'x' },
      },
    ) as {
      planId: string
      approvalId: string
      planHash: string
      preview: { aliasMapped: unknown[]; unknownFields: string[] }
    }

    expect(await db.worldviews.count()).toBe(0)
    expect(plan.preview.aliasMapped).toContainEqual({ from: 'summary', to: 'worldOrigin' })
    expect(plan.preview.unknownFields).toContain('ignored')

    await expect(registry.execute(
      'storyforge.change.commit',
      context(['project:write']),
      { planId: plan.planId },
    )).rejects.toThrow('matching approval is required')

    const result = await registry.execute(
      'storyforge.change.commit',
      context(['project:write'], {
        approval: { approvalId: plan.approvalId, planHash: plan.planHash },
      }),
      { planId: plan.planId },
    ) as { written: unknown[] }

    expect(result.written).toHaveLength(1)
    expect(await db.worldviews.where('projectId').equals(1).first())
      .toMatchObject({ worldOrigin: '炉火创世' })
    await expect(registry.execute(
      'storyforge.change.commit',
      context(['project:write'], {
        approval: { approvalId: plan.approvalId, planHash: plan.planHash },
      }),
      { planId: plan.planId },
    )).rejects.toThrow('plan missing or expired')
  })

  it('rejects a stale plan after project revision changes', async () => {
    const plan = await registry.execute(
      'storyforge.change.propose',
      context(['project:read']),
      { target: 'worldviews', mode: 'replace', data: { worldOrigin: 'before' } },
    ) as { planId: string; approvalId: string; planHash: string }

    await storage.table<{ id?: number; name: string }>('notes').add({ name: 'revision bump' })

    await expect(registry.execute(
      'storyforge.change.commit',
      context(['project:write'], {
        approval: { approvalId: plan.approvalId, planHash: plan.planHash },
      }),
      { planId: plan.planId },
    )).rejects.toThrow('project revision changed')
    expect(await db.worldviews.count()).toBe(0)
  })

  it('rejects unknown context sources and storage/context project mismatches', async () => {
    await expect(registry.execute(
      'storyforge.context.read',
      context(['project:read']),
      { sourceKeys: ['missing-source'] },
    )).rejects.toThrow('unknown sources')

    await expect(registry.execute(
      'storyforge.change.propose',
      context(['project:read'], { project: { backend: 'dexie', projectId: 2 } }),
      { target: 'worldviews', mode: 'replace', data: { worldOrigin: 'x' } },
    )).rejects.toThrow('storage project mismatch')
  })
})

function context(
  scopes: ToolScope[],
  overrides: Partial<ToolExecutionContext> = {},
): ToolExecutionContext {
  return {
    runId: 'run-1',
    conversationId: 'conversation-1',
    sessionId: 'session-1',
    project: { backend: 'dexie', projectId: 1 },
    platform: 'web',
    scopes: new Set(scopes),
    signal: new AbortController().signal,
    actor: { id: 'user-1', kind: 'user' },
    worldGroupId: null,
    ...overrides,
  }
}
