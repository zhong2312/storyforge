import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adopt } from '../../src/lib/registry/adopt'
import { CHARACTER_DIMENSIONS } from '../../src/lib/character/character-dimensions'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'

/**
 * C3 守卫：每个角色维度都必须能被 adopt 写回（FIELD_REGISTRY 已登记），
 * 否则 AI 生成/补全经 adopt 时该维度被当 unknown 静默丢弃 → 用户看不到内容（"不通"）。
 */
describe('R-C3-dimension-coverage', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('每个 CHARACTER_DIMENSIONS 维度都在 FIELD_REGISTRY(characters) 登记', () => {
    const registered = new Set((FIELD_BY_TARGET.get('characters') ?? []).map(f => f.field))
    const missing = CHARACTER_DIMENSIONS.map(d => d.key).filter(k => !registered.has(k))
    expect(missing).toEqual([])
  })

  it('生成路径：一次 adopt 写入全部维度 → 全部落库，无静默丢弃', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({ name: 'P', genre: 'x', createdAt: now, updatedAt: now } as any) as number
    // 模拟生成器 onAccept：每个维度填一个可识别值
    const dimData = Object.fromEntries(CHARACTER_DIMENSIONS.map(d => [d.key, `V-${d.key}`]))
    const result = await adopt({
      projectId, target: 'characters', mode: 'add',
      data: { name: '全维度', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', ...dimData },
    })
    expect(result.unknown).toEqual([])              // 没有任何维度被判为 unknown
    const row = await db.characters.where('projectId').equals(projectId).first()
    for (const d of CHARACTER_DIMENSIONS) {
      expect((row as any)[d.key]).toBe(`V-${d.key}`) // 每个维度都真落库
    }
  })

  it('中文展示名路径：角色方案中的中文字段可规范化并完整落库', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({ name: 'P', genre: 'x', createdAt: now, updatedAt: now } as any) as number
    const result = await adopt({
      projectId,
      target: 'characters',
      mode: 'add',
      data: {
        name: '别名角色',
        roleWeight: 'secondary',
        moralAxis: 'good',
        orderAxis: 'lawful',
        人物关系: '与主角互为镜像',
        '年龄·性别·种族': '二十岁，女，人族',
        '动机/欲望': '摆脱家族控制',
        '目标(短/长期)': '短期离城，长期重建秩序',
        '核心矛盾/内心冲突': '自由与责任冲突',
        '关键经历/转折': '目睹旧城覆灭',
        '标志性物品/符号': '断弦古琴',
        在故事中的作用: '推动旧案真相浮出水面',
        结局走向: '主动放弃权位，远行求道',
      },
    })

    expect(result.unknown).toEqual([])
    expect(result.aliasMapped).toContainEqual({ from: '结局走向', to: 'ending' })
    const row = await db.characters.where('projectId').equals(projectId).first()
    expect(row).toMatchObject({
      relationships: '与主角互为镜像',
      profile: '二十岁，女，人族',
      motivation: '摆脱家族控制',
      goals: '短期离城，长期重建秩序',
      innerConflict: '自由与责任冲突',
      keyEvents: '目睹旧城覆灭',
      signatureItem: '断弦古琴',
      storyRole: '推动旧案真相浮出水面',
      ending: '主动放弃权位，远行求道',
    })
  })
})
