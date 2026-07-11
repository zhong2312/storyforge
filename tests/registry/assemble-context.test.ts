/**
 * Phase 1.3a · CONTEXT_SOURCES + assembleContext()
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { CONTEXT_SOURCES } from '../../src/lib/registry/context-sources'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { checkRegistry } from '../../src/lib/registry/validate'
import { MemoryProjectStorage } from '../../src/lib/storage/adapters/memory/memory-project-storage'

async function createProject(): Promise<number> {
  const now = Date.now()
  return await db.projects.add({
    name: 'Context Test',
    genre: '',
    description: '',
    targetWordCount: 0,
    enableMultiWorld: true,
    createdAt: now,
    updatedAt: now,
  } as any) as number
}

describe('Phase 1.3a · 统一上下文装配层', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
  })

  it('CONTEXT_SOURCES 登记完整且通过 registry 校验', () => {
    expect(CONTEXT_SOURCES.length).toBeGreaterThanOrEqual(17)
    const keys = CONTEXT_SOURCES.map(s => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const source of CONTEXT_SOURCES.filter(s => s.scope === 'world')) {
      expect(source.requiresWorldGroupId, source.key).toBe(true)
    }

    const result = checkRegistry()
    if (!result.ok) console.error(result.errors)
    expect(result.ok, result.errors.join('; ')).toBe(true)
  })

  it('assembleContext 按显式 worldGroupId 隔离世界观和角色', async () => {
    const now = Date.now()
    const projectId = await createProject()
    const worldA = await db.worldGroups.add({
      projectId, name: '炉火界', type: 'primary', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const worldB = await db.worldGroups.add({
      projectId, name: '冰海界', type: 'parallel', order: 1, createdAt: now, updatedAt: now,
    } as any) as number
    await db.worldviews.add({
      projectId, worldGroupId: worldA, worldOrigin: '炉火界只信奉火焰契约', createdAt: now, updatedAt: now,
    } as any)
    await db.worldviews.add({
      projectId, worldGroupId: worldB, worldOrigin: '冰海界由潮汐神殿统治', createdAt: now, updatedAt: now,
    } as any)
    await db.characters.add({
      projectId, homeWorldGroupId: worldA, name: '赤衡', role: 'protagonist', shortDescription: '火契继承人', createdAt: now, updatedAt: now,
    } as any)
    await db.characters.add({
      projectId, homeWorldGroupId: worldB, name: '澜青', role: 'antagonist', shortDescription: '潮汐祭司', createdAt: now, updatedAt: now,
    } as any)

    const assembled = await assembleContext({
      projectId,
      worldGroupId: worldA,
      sourceKeys: ['worldview', 'characters'],
    })

    expect(assembled.included).toEqual(['worldview', 'characters'])
    expect(assembled.text).toContain('炉火界只信奉火焰契约')
    expect(assembled.text).toContain('赤衡')
    expect(assembled.text).not.toContain('冰海界由潮汐神殿统治')
    expect(assembled.text).not.toContain('澜青')
  })

  it('worldGroupId 为 null 时世界观/力量体系可回退到项目首条，非 null 仍严格隔离', async () => {
    const now = Date.now()
    const projectId = await createProject()
    const primaryWorld = await db.worldGroups.add({
      projectId, name: '主世界', type: 'primary', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const otherWorld = await db.worldGroups.add({
      projectId, name: '副世界', type: 'parallel', order: 1, createdAt: now, updatedAt: now,
    } as any) as number
    await db.worldviews.add({
      projectId, worldGroupId: primaryWorld, worldOrigin: '星门坠落后灵气复苏', createdAt: now, updatedAt: now,
    } as any)
    await db.powerSystems.add({
      projectId, worldGroupId: primaryWorld, name: '星门修炼法', description: '观星入境', levels: '[]', rules: '不可越阶吸收星核', createdAt: now, updatedAt: now,
    } as any)

    const defaultCtx = await assembleContext({
      projectId,
      worldGroupId: null,
      sourceKeys: ['worldview', 'powerSystem'],
    })

    expect(defaultCtx.included).toEqual(['worldview', 'powerSystem'])
    expect(defaultCtx.text).toContain('星门坠落后灵气复苏')
    expect(defaultCtx.text).toContain('星门修炼法')

    const isolatedCtx = await assembleContext({
      projectId,
      worldGroupId: otherWorld,
      sourceKeys: ['worldview', 'powerSystem'],
    })

    expect(isolatedCtx.text).not.toContain('星门坠落后灵气复苏')
    expect(isolatedCtx.text).not.toContain('星门修炼法')
  })

  it('worldRules 按 worldGroupId 隔离 profile 与历史辅助数据', async () => {
    const now = Date.now()
    const projectId = await createProject()
    const worldA = await db.worldGroups.add({
      projectId, name: '镜城', type: 'primary', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const worldB = await db.worldGroups.add({
      projectId, name: '雾都', type: 'parallel', order: 1, createdAt: now, updatedAt: now,
    } as any) as number

    await db.worldRulesProfiles.add({
      projectId,
      worldGroupId: worldA,
      entries: {
        'era.period': {
          historicalAnchors: '镜城沿用宋代市舶司制度',
          fictionalAdaptations: '镜城增设镜税',
          priority: 'balanced',
        },
      },
      customNodes: [],
      createdAt: now,
      updatedAt: now,
    } as any)
    await db.worldRulesProfiles.add({
      projectId,
      worldGroupId: worldB,
      entries: {
        'era.period': {
          historicalAnchors: '雾都沿用维多利亚街区制度',
          fictionalAdaptations: '雾都由雾钟议会统治',
          priority: 'fictional',
        },
      },
      customNodes: [],
      createdAt: now,
      updatedAt: now,
    } as any)
    await db.historicalTimelineEvents.add({
      projectId, worldGroupId: worldA, era: 'custom', year: 1, date: '镜元年',
      title: '镜城开埠', description: '', isHistorical: false, createdAt: now, updatedAt: now,
    } as any)
    await db.historicalTimelineEvents.add({
      projectId, worldGroupId: worldB, era: 'custom', year: 1, date: '雾元年',
      title: '雾钟敲响', description: '', isHistorical: false, createdAt: now, updatedAt: now,
    } as any)
    await db.historicalKeywords.add({
      projectId, worldGroupId: worldA, keyword: '镜税', category: 'politics', era: 'custom',
      description: '', createdAt: now, updatedAt: now,
    } as any)
    await db.historicalKeywords.add({
      projectId, worldGroupId: worldB, keyword: '雾钟', category: 'politics', era: 'custom',
      description: '', createdAt: now, updatedAt: now,
    } as any)

    const assembled = await assembleContext({
      projectId,
      worldGroupId: worldA,
      sourceKeys: ['worldRules'],
    })

    expect(assembled.included).toEqual(['worldRules'])
    expect(assembled.text).toContain('镜城沿用宋代市舶司制度')
    expect(assembled.text).toContain('镜城开埠')
    expect(assembled.text).toContain('镜税')
    expect(assembled.text).not.toContain('雾都沿用维多利亚街区制度')
    expect(assembled.text).not.toContain('雾钟敲响')
    expect(assembled.text).not.toContain('雾钟')
  })

  it('historical source 按 worldGroupId 读取当前世界 + 全局旧数据', async () => {
    const now = Date.now()
    const projectId = await createProject()
    const worldA = await db.worldGroups.add({
      projectId, name: '镜城', type: 'primary', order: 0, createdAt: now, updatedAt: now,
    } as any) as number
    const worldB = await db.worldGroups.add({
      projectId, name: '雾都', type: 'parallel', order: 1, createdAt: now, updatedAt: now,
    } as any) as number

    await db.historicalTimelineEvents.bulkAdd([
      { projectId, worldGroupId: worldA, era: 'custom', year: 1, date: '镜元年', title: '镜城开埠', description: '', isHistorical: false, createdAt: now, updatedAt: now },
      { projectId, worldGroupId: worldB, era: 'custom', year: 2, date: '雾元年', title: '雾钟敲响', description: '', isHistorical: false, createdAt: now, updatedAt: now },
      { projectId, worldGroupId: null, era: 'custom', year: 0, date: '旧纪元', title: '全局旧史', description: '', isHistorical: true, createdAt: now, updatedAt: now },
    ] as any[])
    await db.historicalKeywords.bulkAdd([
      { projectId, worldGroupId: worldA, keyword: '镜税', category: 'politics', era: 'custom', description: '', createdAt: now, updatedAt: now },
      { projectId, worldGroupId: worldB, keyword: '雾钟', category: 'politics', era: 'custom', description: '', createdAt: now, updatedAt: now },
      { projectId, worldGroupId: null, keyword: '通用礼法', category: 'culture', era: 'custom', description: '', createdAt: now, updatedAt: now },
    ] as any[])

    const assembled = await assembleContext({
      projectId,
      worldGroupId: worldA,
      sourceKeys: ['historical'],
    })

    expect(assembled.included).toEqual(['historical'])
    expect(assembled.text).toContain('镜城开埠')
    expect(assembled.text).toContain('镜税')
    expect(assembled.text).toContain('全局旧史')
    expect(assembled.text).toContain('通用礼法')
    expect(assembled.text).not.toContain('雾钟敲响')
    expect(assembled.text).not.toContain('雾钟')
  })

  it('assembleContext 真裁剪:预算不足时 L3 从最终文本移除', async () => {
    const now = Date.now()
    const projectId = await createProject()
    // L3 源「引用手法」:参考作品 + 一条超长维度分析
    const refId = await db.references.add({
      projectId, title: '长篇参考作品', author: '某大师', type: 'reference',
      analysisStatus: 'done', analysisProgress: 100,
      createdAt: now, updatedAt: now,
    } as any) as number
    await db.referenceChunkAnalysis.add({
      referenceId: refId, chunkIndex: 0,
      narrativeStyle: '这是一段非常长的叙事手法分析。'.repeat(200),
      createdAt: now,
    } as any)

    const assembled = await assembleContext({
      projectId,
      sourceKeys: ['previousChapterEnding', 'references'],
      previousChapterEnding: '主角在城门前发现旧王印记。',
      citedReferenceIds: [refId],
      inputBudgetTokens: 60,
    })

    expect(assembled.overBudgetBeforeTrim).toBe(true)
    expect(assembled.included).toEqual(['previousChapterEnding'])
    expect(assembled.trimmed).toContain('references')
    expect(assembled.text).toContain('旧王印记')
    expect(assembled.text).not.toContain('非常长的叙事手法分析')
  })

  it('统一存储端口的前文召回按规范章序排除当前章和未来章', async () => {
    const storage = new MemoryProjectStorage({ backend: 'dexie', projectId: 77 })
    const now = Date.now()
    await storage.table('projects').put({ id: 77, name: '文件项目', createdAt: now, updatedAt: now })
    const volumeId = await storage.table('outlineNodes').add({
      projectId: 77, parentId: null, type: 'volume', title: '第一卷', summary: '', order: 0,
      createdAt: now, updatedAt: now,
    })
    const nodeIds: number[] = []
    const chapterIds: number[] = []
    for (let index = 0; index < 3; index += 1) {
      const nodeId = await storage.table('outlineNodes').add({
        projectId: 77, parentId: volumeId, type: 'chapter', title: `第${index + 1}章`, summary: '林飞', order: index,
        createdAt: now, updatedAt: now,
      })
      nodeIds.push(nodeId)
      chapterIds.push(await storage.table('chapters').add({
        projectId: 77, outlineNodeId: nodeId, title: `第${index + 1}章`, content: '', order: index,
        createdAt: now, updatedAt: now,
      }))
    }
    await storage.table('characters').add({ projectId: 77, name: '林飞', createdAt: now, updatedAt: now })
    await storage.table('retrievalChunks').bulkPut([
      { id: 1, projectId: 77, sourceChapterId: chapterIds[0], chunkIndex: 0, text: '林飞在前文取得旧印', keywords: ['林飞'], sourceTextHash: 'a', createdAt: now },
      { id: 2, projectId: 77, sourceChapterId: chapterIds[1], chunkIndex: 0, text: '林飞当前章秘密', keywords: ['林飞'], sourceTextHash: 'b', createdAt: now },
      { id: 3, projectId: 77, sourceChapterId: chapterIds[2], chunkIndex: 0, text: '林飞未来章秘密', keywords: ['林飞'], sourceTextHash: 'c', createdAt: now },
    ])
    await storage.table('narrativeSummaryNodes').bulkPut([
      { id: 1, projectId: 77, level: 'chapter', status: 'verified', sourceChapterId: chapterIds[0], title: '前章摘要', summary: '林飞拿到旧印', createdAt: now, updatedAt: now },
      { id: 2, projectId: 77, level: 'chapter', status: 'verified', sourceChapterId: chapterIds[2], title: '未来摘要', summary: '未来真相', createdAt: now, updatedAt: now },
    ])

    const context = await assembleContext({
      projectId: 77,
      storage,
      chapterId: chapterIds[1],
      outlineNodeId: nodeIds[1],
      worldGroupId: null,
      sourceKeys: ['retrievedPassages'],
    })
    expect(context.text).toContain('林飞在前文取得旧印')
    expect(context.text).toContain('林飞拿到旧印')
    expect(context.text).not.toContain('当前章秘密')
    expect(context.text).not.toContain('未来章秘密')
    expect(context.text).not.toContain('未来真相')

    const orphan = await assembleContext({
      projectId: 77,
      storage,
      chapterId: 999,
      outlineNodeId: nodeIds[1],
      worldGroupId: null,
      sourceKeys: ['retrievedPassages'],
    })
    expect(orphan.text).toBe('')
  })
})
