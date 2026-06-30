import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'

/** C2 反向哺喂：characterFacts / characterPassages 两个角色域上下文源。 */
describe('R-C2-character-evidence', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  async function seed() {
    const now = Date.now()
    const pid = await db.projects.add({ name: 'P', genre: 'wuxia', createdAt: now, updatedAt: now } as any) as number
    const ch = await db.chapters.add({ projectId: pid, outlineNodeId: 0, title: '第5章·夜袭', content: '', wordCount: 0, status: 'draft', order: 4, notes: '', createdAt: now, updatedAt: now } as any) as number
    return { pid, ch, now }
  }

  it('characterFacts 只取该角色 confirmed 事实，按 subjectName 命中、忽略他人/未确认', async () => {
    const { pid, ch, now } = await seed()
    await db.temporalFacts.add({ projectId: pid, subjectName: '云无心', predicate: 'location', factKind: 'state', value: '城南客栈', sourceType: 'chapter', sourceChapterId: ch, validFromChapterId: ch, validToChapterId: null, status: 'confirmed', locked: false, createdAt: now, updatedAt: now } as any)
    await db.temporalFacts.add({ projectId: pid, subjectName: '云无心', predicate: 'location', factKind: 'state', value: '废弃身份', sourceType: 'chapter', status: 'stale', locked: false, createdAt: now, updatedAt: now } as any)
    await db.temporalFacts.add({ projectId: pid, subjectName: '别人', predicate: 'location', factKind: 'state', value: '不该出现', sourceType: 'chapter', status: 'confirmed', locked: false, createdAt: now, updatedAt: now } as any)

    const res = await assembleContext({ projectId: pid, sourceKeys: ['characterFacts'], subjectCharacterName: '云无心' })
    expect(res.text).toContain('城南客栈')
    expect(res.text).not.toContain('废弃身份') // 非 confirmed
    expect(res.text).not.toContain('不该出现') // 他人
    expect(res.text).toContain('云无心')
  })

  it('characterPassages 关键词扫正文块命中该角色，世界隔离生效', async () => {
    const { pid, ch, now } = await seed()
    await db.retrievalChunks.add({ projectId: pid, worldGroupId: null, sourceChapterId: ch, text: '云无心出手如电，一招制敌。', createdAt: now } as any)
    await db.retrievalChunks.add({ projectId: pid, worldGroupId: 999, sourceChapterId: ch, text: '云无心在另一个世界的桥段。', createdAt: now } as any)
    await db.retrievalChunks.add({ projectId: pid, worldGroupId: null, sourceChapterId: ch, text: '与本角色无关的一段。', createdAt: now } as any)

    const res = await assembleContext({ projectId: pid, sourceKeys: ['characterPassages'], subjectCharacterName: '云无心', worldGroupId: null })
    expect(res.text).toContain('一招制敌')        // 命中、当前世界(null)
    expect(res.text).not.toContain('另一个世界')  // 世界隔离
    expect(res.text).not.toContain('无关的一段')  // 未命中名字
  })

  it('无 subjectCharacterName 时两个源被跳过（enabled=false），不报错', async () => {
    const { pid } = await seed()
    const res = await assembleContext({ projectId: pid, sourceKeys: ['characterFacts', 'characterPassages'] })
    expect(res.text).toBe('')
  })
})
