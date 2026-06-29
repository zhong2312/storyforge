/**
 * R-NS4-current-facts · currentFacts 上下文源（NS-4 ③）
 * 守卫：只注入 confirmed 事实；按规范章序判定"截止本章有效"（生效/未生效/已失效）；按世界过滤。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { CONTEXT_SOURCES } from '../../src/lib/registry/context-sources'

const now = Date.now()
const currentFacts = CONTEXT_SOURCES.find(s => s.key === 'currentFacts')!

async function seed() {
  const pid = await db.projects.add({ name: 'P', genre: 'x', description: '', targetWordCount: 0, enableMultiWorld: false, createdAt: now, updatedAt: now } as any) as number
  const vol = await db.outlineNodes.add({ projectId: pid, parentId: null, type: 'volume', title: '卷', summary: '', order: 0, createdAt: now, updatedAt: now } as any) as number
  const nodes: number[] = []
  const chaps: number[] = []
  for (let i = 0; i < 3; i++) {
    const n = await db.outlineNodes.add({ projectId: pid, parentId: vol, type: 'chapter', title: `第${i + 1}章`, summary: '', order: i, createdAt: now, updatedAt: now } as any) as number
    const c = await db.chapters.add({ projectId: pid, outlineNodeId: n, title: `第${i + 1}章`, content: '', wordCount: 0, status: 'draft', order: i, notes: '', createdAt: now, updatedAt: now } as any) as number
    nodes.push(n); chaps.push(c)
  }
  return { pid, chaps } // chaps[0..2] 规范序 0,1,2
}
const fact = (pid: number, over: any) => db.temporalFacts.add({ projectId: pid, subjectName: '林飞', predicate: 'location', factKind: 'state', value: 'X', sourceType: 'chapter', status: 'confirmed', locked: false, worldGroupId: null, createdAt: now, updatedAt: now, ...over } as any)

describe('NS-4 · currentFacts 源', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('截止本章(第2章)有效性:生效注入、未生效排除、已失效排除', async () => {
    const { pid, chaps } = await seed()
    await fact(pid, { value: '洛阳', validFromChapterId: chaps[0], validToChapterId: null })   // 生效中
    await fact(pid, { value: '北境', validFromChapterId: chaps[2], validToChapterId: null })   // 第3章才生效
    await fact(pid, { value: '旧城', validFromChapterId: chaps[0], validToChapterId: chaps[1], predicate: 'powerStage' }) // 第2章起失效
    const out = await currentFacts.read({ projectId: pid, chapterId: chaps[1] } as any)
    expect(out).toContain('洛阳')
    expect(out).not.toContain('北境')
    expect(out).not.toContain('旧城')
  })

  it('只注入 confirmed,候选不注入', async () => {
    const { pid, chaps } = await seed()
    await fact(pid, { value: '候选地', status: 'candidate', validFromChapterId: chaps[0] })
    const out = await currentFacts.read({ projectId: pid, chapterId: chaps[1] } as any)
    expect(out).not.toContain('候选地')
  })

  it('世界过滤:别的世界的事实不串入当前世界', async () => {
    const { pid, chaps } = await seed()
    await fact(pid, { value: '本界事', validFromChapterId: chaps[0], worldGroupId: 7 })
    await fact(pid, { value: '他界事', validFromChapterId: chaps[0], worldGroupId: 99 })
    const out = await currentFacts.read({ projectId: pid, chapterId: chaps[1], worldGroupId: 7 } as any)
    expect(out).toContain('本界事')
    expect(out).not.toContain('他界事')
  })
})
