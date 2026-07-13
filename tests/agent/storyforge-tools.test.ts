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

  it('exposes immutable descriptors for the generic registry tools', () => {
    expect(registry.listAvailable(context(['project:read'])).map(tool => tool.name)).toEqual([
      'storyforge.settings.catalog',
      'storyforge.context.read',
      'storyforge.rag.search',
      'storyforge.prose.deai.inspect',
      'storyforge.change.propose',
    ])
    expect(registry.get('storyforge.change.commit')?.requiredScopes).toEqual(['project:write'])
  })

  it('deai.inspect blocks proposals when numbers, names, or most prose are lost', async () => {
    const originalText = '林砚在第3天带着12枚铜钱来到渡口。'.repeat(10)
    const chapterId = await db.chapters.add({ projectId: 1, content: `<p>${originalText}</p>` } as never) as number
    const output = await registry.execute(
      'storyforge.prose.deai.inspect',
      context(['project:read'], { chapterId }),
      { originalText: '他到了渡口。', candidateText: '他到了渡口。', protectedTerms: ['林砚'] },
    ) as {
      blocked: boolean
      canPropose: boolean
      originalSource: string
      safety: { missingNumbers: string[]; missingProtectedTerms: string[]; lengthRatio: number }
    }

    expect(output.blocked).toBe(true)
    expect(output.canPropose).toBe(false)
    expect(output.originalSource).toBe('chapter-storage')
    expect(output.safety.missingNumbers).toEqual(expect.arrayContaining(['3', '12']))
    expect(output.safety.missingProtectedTerms).toContain('林砚')
    expect(output.safety.lengthRatio).toBeLessThan(0.75)
  })

  it('rag.search retrieves current project data through the registered context source', async () => {
    await db.characters.add({
      projectId: 1,
      name: '沈砚',
      role: 'supporting',
      roleWeight: 'secondary',
      moralAxis: 'neutral',
      orderAxis: 'lawful',
      ending: '在终局封存潮汐神印',
      createdAt: 100,
      updatedAt: 100,
    } as never)

    const output = await registry.execute(
      'storyforge.rag.search',
      context(['project:read']),
      { query: '谁封存潮汐神印', sourceTables: ['characters'], topK: 5 },
    ) as { hitCount: number; text: string; included: string[] }

    expect(output.hitCount).toBeGreaterThan(0)
    expect(output.included).toEqual(['ragSearch'])
    expect(output.text).toContain('[characters#')
    expect(output.text).toContain('沈砚')
    expect(output.text).toContain('封存潮汐神印')
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
    expect(registry.get('storyforge.settings.catalog')?.title).toBe(
      `设定能力目录（${output.readSources.length} 个读取源 / ${output.writeTargets.length} 个写入目标）`,
    )
    expect(output.readSources.some(source => source.key === 'chapterIndex')).toBe(true)
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

  it('resolves a chapter ordinal to real IDs before reading chapter-scoped context', async () => {
    const now = 100
    const volumeId = await db.outlineNodes.add({
      projectId: 1,
      parentId: null,
      type: 'volume',
      title: '第一卷',
      summary: '启程',
      order: 0,
      createdAt: now,
      updatedAt: now,
    }) as number
    const outlineNodeId = await db.outlineNodes.add({
      projectId: 1,
      parentId: volumeId,
      type: 'chapter',
      title: '第一章 山雨欲来',
      summary: '林默在雨夜发现炉火异动。',
      order: 0,
      createdAt: now,
      updatedAt: now,
    }) as number
    const chapterId = await db.chapters.add({
      projectId: 1,
      outlineNodeId,
      title: '第一章 山雨欲来',
      content: '',
      wordCount: 0,
      status: 'outline',
      order: 99,
      notes: '',
      createdAt: now,
      updatedAt: now,
    }) as number

    const index = await registry.execute(
      'storyforge.context.read',
      context(['project:read']),
      { sourceKeys: ['chapterIndex'], chapterOrdinal: 1 },
    ) as { text: string; resolvedScope: { chapterOrdinal: number } }

    expect(index.text).toContain('→ 第1章')
    expect(index.text).toContain(`outlineNodeId=${outlineNodeId}`)
    expect(index.text).toContain(`chapterId=${chapterId}`)
    expect(index.resolvedScope.chapterOrdinal).toBe(1)

    const scoped = await registry.execute(
      'storyforge.context.read',
      context(['project:read']),
      { sourceKeys: ['chapterOutline'], outlineNodeId, chapterId },
    ) as { text: string; resolvedScope: { outlineNodeId: number; chapterId: number } }

    expect(scoped.text).toContain('林默在雨夜发现炉火异动。')
    expect(scoped.resolvedScope).toMatchObject({ outlineNodeId, chapterId })
  })

  it('does not let a context read override host-locked chapter scope', async () => {
    await expect(registry.execute(
      'storyforge.context.read',
      context(['project:read'], { chapterId: 7, outlineNodeId: 8 }),
      { sourceKeys: ['chapterOutline'], chapterId: 9, outlineNodeId: 8 },
    )).rejects.toThrow('chapterId is locked by host scope')
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

  it('derives chapter wordCount from proposed content instead of trusting the model estimate', async () => {
    const now = 100
    const volumeId = await db.outlineNodes.add({
      projectId: 1,
      parentId: null,
      type: 'volume',
      title: '第一卷',
      summary: '',
      order: 0,
      createdAt: now,
      updatedAt: now,
    }) as number
    const outlineNodeId = await db.outlineNodes.add({
      projectId: 1,
      parentId: volumeId,
      type: 'chapter',
      title: '第一章',
      summary: '',
      order: 0,
      createdAt: now,
      updatedAt: now,
    }) as number
    const chapterId = await db.chapters.add({
      projectId: 1,
      outlineNodeId,
      title: '第一章',
      content: '',
      wordCount: 0,
      status: 'outline',
      order: 0,
      notes: '',
      createdAt: now,
      updatedAt: now,
    }) as number
    const content = '<p>雨夜 山门</p><p>追兵将至</p>'

    const plan = await registry.execute(
      'storyforge.change.propose',
      context(['project:read'], { chapterId, outlineNodeId }),
      {
        target: 'chapters',
        mode: 'replace',
        recordId: chapterId,
        data: { content, wordCount: 1, status: 'draft' },
      },
    ) as {
      planId: string
      approvalId: string
      planHash: string
      input: { data: { wordCount: number } }
      preview: { canonicalFields: string[] }
      beforeData: { content: string }
    }

    expect(plan.input.data.wordCount).toBe(8)
    expect(plan.preview.canonicalFields).toContain('wordCount')
    expect(plan.beforeData.content).toBe('')

    await registry.execute(
      'storyforge.change.commit',
      context(['project:write'], {
        chapterId,
        outlineNodeId,
        approval: { approvalId: plan.approvalId, planHash: plan.planHash },
      }),
      { planId: plan.planId },
    )

    expect(await db.chapters.get(chapterId)).toMatchObject({ content, wordCount: 8, status: 'draft' })
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
