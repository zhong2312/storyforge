import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adopt } from '../../src/lib/registry/adopt'
import { normalizeDetailedScenes } from '../../src/lib/types/detailed-outline'
import type { DetailedScene } from '../../src/lib/types/detailed-outline'

const scene = (over: Partial<DetailedScene> = {}): DetailedScene => ({
  sceneId: 's1', title: '初遇', summary: '主角登场', characterIds: [],
  location: '城门', conflict: '冲突', pace: 'medium', estimatedWords: 800, notes: '', ...over,
})

describe('R-CF2-scenes-array', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('normalizeDetailedScenes：数组原样、字符串parse回数组、垃圾→空、对象数组里非对象项过滤', () => {
    expect(normalizeDetailedScenes([scene()])).toHaveLength(1)
    expect(normalizeDetailedScenes(JSON.stringify([scene(), scene({ sceneId: 's2' })]))).toHaveLength(2)
    expect(normalizeDetailedScenes('不是JSON')).toEqual([])
    expect(normalizeDetailedScenes(undefined)).toEqual([])
    expect(normalizeDetailedScenes(123 as unknown)).toEqual([])
    expect(normalizeDetailedScenes(['x', null, scene()] as unknown)).toHaveLength(1) // 只保留对象
  })

  it('adopt detailedOutlines.scenes 后 DB 仍为数组（json→arr 根因修复，不再被 stringify）', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({ name: 'P', createdAt: now, updatedAt: now } as any) as number
    const nodeId = await db.outlineNodes.add({ projectId, type: 'chapter', title: '第1章', parentId: null, order: 0, summary: '', createdAt: now, updatedAt: now } as any) as number

    await adopt({
      projectId, target: 'detailedOutlines', mode: 'add',
      data: { outlineNodeId: nodeId, scenes: [scene(), scene({ sceneId: 's2', title: '冲突' })] },
    })
    const row = await db.detailedOutlines.where('outlineNodeId').equals(nodeId).first()
    expect(Array.isArray(row!.scenes)).toBe(true)          // 关键：不是字符串
    expect(row!.scenes).toHaveLength(2)
    expect(() => (row!.scenes as DetailedScene[]).reduce((s, sc) => s + sc.estimatedWords, 0)).not.toThrow()
  })

  it('旧库字符串 scenes：normalizeDetailedScenes 读取自愈，渲染端 .reduce 不再崩', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({ name: 'P2', createdAt: now, updatedAt: now } as any) as number
    // 模拟历史 bug 数据：scenes 被存成 JSON 字符串
    const id = await db.detailedOutlines.add({ projectId, outlineNodeId: 1, scenes: JSON.stringify([scene()]) as any, createdAt: now, updatedAt: now } as any) as number
    const raw = await db.detailedOutlines.get(id)
    expect(typeof raw!.scenes).toBe('string')              // 旧脏数据确实是字符串
    const healed = normalizeDetailedScenes(raw!.scenes)
    expect(Array.isArray(healed)).toBe(true)
    expect(healed).toHaveLength(1)
  })
})
