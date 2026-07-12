/**
 * Phase 1.2a · FIELD_REGISTRY + AdoptionSchema + adopt()
 *
 * 本测试只验证纯新增写回层,不迁移现有调用方。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { FIELD_REGISTRY, FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { ADOPTION_SCHEMAS, ADOPTION_BY_TARGET } from '../../src/lib/registry/adoption-schema'
import { REGISTRY_BY_NAME } from '../../src/lib/registry/project-tables'
import { adopt } from '../../src/lib/registry/adopt'

async function createProject(): Promise<number> {
  const now = Date.now()
  return await db.projects.add({
    name: 'Adopt Test',
    genre: '',
    description: '',
    targetWordCount: 0,
    enableMultiWorld: true,
    createdAt: now,
    updatedAt: now,
  } as any) as number
}

describe('Phase 1.2a · 统一写回层', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
  })

  it('FIELD_REGISTRY / ADOPTION_SCHEMAS 只指向已登记表', () => {
    expect(FIELD_REGISTRY.length).toBeGreaterThan(70)
    for (const field of FIELD_REGISTRY) {
      expect(REGISTRY_BY_NAME.has(field.target), `FIELD_REGISTRY target 缺表:${field.target}`).toBe(true)
    }
    for (const schema of ADOPTION_SCHEMAS) {
      expect(REGISTRY_BY_NAME.has(schema.target), `ADOPTION_SCHEMA target 缺表:${schema.target}`).toBe(true)
      expect(FIELD_BY_TARGET.has(schema.target), `ADOPTION_SCHEMA target 缺字段:${schema.target}`).toBe(true)
      expect(ADOPTION_BY_TARGET.get(schema.target)).toBe(schema)
    }
  })

  it('单例写回:worldviews.summary 自动映射到 worldOrigin', async () => {
    const projectId = await createProject()
    const result = await adopt({
      projectId,
      worldGroupId: 101,
      target: 'worldviews',
      mode: 'replace',
      data: {
        summary: '天地由九重炉火锻成',
        powerHierarchy: '凡人 / 修士 / 天君',
        ignoredField: 'x',
      },
    })

    expect(result.aliasMapped).toContainEqual({ from: 'summary', to: 'worldOrigin' })
    expect(result.unknown).toContain('ignoredField')
    expect(result.written.length).toBe(1)

    const rows = await db.worldviews.where('projectId').equals(projectId).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].worldOrigin).toBe('天地由九重炉火锻成')
    expect(rows[0].powerHierarchy).toBe('凡人 / 修士 / 天君')
    expect(rows[0].worldGroupId).toBe(101)
  })

  it('单例写回:worldviews 原生对象字段保持对象，不序列化成字符串', async () => {
    const projectId = await createProject()
    const divineDesign = {
      hasDivinity: true,
      divineRank: '主神 / 次神',
      divineNames: '星母',
      divineRules: '朔日禁火',
    }
    await adopt({
      projectId,
      target: 'worldviews',
      mode: 'replace',
      data: { divineDesign },
    })

    const row = await db.worldviews.where('projectId').equals(projectId).first()
    expect(row?.divineDesign).toEqual(divineDesign)
    expect(typeof row?.divineDesign).toBe('object')
  })

  it('单例写回:storyCores.storyLines 自动映射到 mainPlot,append 合并长文本', async () => {
    const projectId = await createProject()
    await adopt({
      projectId,
      target: 'storyCores',
      mode: 'replace',
      data: { storyLines: '主角寻找失落星门', theme: '自由意志' },
    })
    await adopt({
      projectId,
      target: 'storyCores',
      mode: 'append',
      data: { mainPlot: '星门背后是旧时代谎言' },
    })

    const row = await db.storyCores.where('projectId').equals(projectId).first()
    expect(row?.mainPlot).toBe('主角寻找失落星门\n\n星门背后是旧时代谎言')
    expect(row?.theme).toBe('自由意志')
  })

  it('集合写回:characters 中文 role 归一,同名角色自动合并', async () => {
    const projectId = await createProject()
    const result = await adopt({
      projectId,
      worldGroupId: 7,
      target: 'characters',
      mode: 'add-many',
      data: [
        { name: '燕飞', role: '主角', summary: '背负旧王血脉' },
        { name: '燕飞', role: '反派', summary: '重复角色' },
      ],
    })

    expect(result.written.length).toBe(2)
    expect(result.skipped).toHaveLength(0)
    expect(result.aliasMapped).toContainEqual({ from: 'summary', to: 'shortDescription' })

    const rows = await db.characters.where('projectId').equals(projectId).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('燕飞')
    expect(rows[0].role).toBe('antagonist')
    expect(rows[0].shortDescription).toBe('重复角色')
    expect(rows[0].homeWorldGroupId).toBe(7)
  })

  it('集合写回:characters 同名不同世界不误合并', async () => {
    const projectId = await createProject()
    await adopt({
      projectId,
      worldGroupId: 1,
      target: 'characters',
      mode: 'add',
      data: { name: '燕飞', role: '主角', summary: '主世界角色' },
    })
    await adopt({
      projectId,
      worldGroupId: 2,
      target: 'characters',
      mode: 'add',
      data: { name: '燕飞', role: '反派', summary: '副世界角色' },
    })

    const rows = await db.characters.where('projectId').equals(projectId).toArray()
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.homeWorldGroupId).sort()).toEqual([1, 2])
    expect(rows.find(r => r.homeWorldGroupId === 1)?.role).toBe('protagonist')
    expect(rows.find(r => r.homeWorldGroupId === 2)?.role).toBe('antagonist')
  })

  it('集合写回:codexEntries 校验 categoryId,无效 FK 不落库', async () => {
    const projectId = await createProject()
    const now = Date.now()
    const categoryId = await db.codexCategories.add({
      projectId,
      domain: 'natural',
      parentId: null,
      name: '矿物',
      fieldSchema: '[]',
      order: 0,
      worldGroupId: null,
      createdAt: now,
      updatedAt: now,
    } as any) as number

    const bad = await adopt({
      projectId,
      target: 'codexEntries',
      mode: 'add',
      data: { categoryId: 9999, name: '不存在分类下的玄铁' },
    })
    expect(bad.fkErrors).toContainEqual({ field: 'categoryId', refValue: 9999 })
    expect(await db.codexEntries.count()).toBe(0)

    const good = await adopt({
      projectId,
      worldGroupId: 3,
      target: 'codexEntries',
      mode: 'add',
      data: { categoryId, name: '九曜玄铁', fields: { rank: '神品' }, refs: {} },
    })
    expect(good.written.length).toBe(1)
    const row = await db.codexEntries.where('projectId').equals(projectId).first()
    expect(row?.categoryId).toBe(categoryId)
    expect(row?.worldGroupId).toBe(3)
    expect(row?.fields).toBe(JSON.stringify({ rank: '神品' }))
  })

  it('集合定点写回:历史 Agent 只更新指定记录的正式结果字段', async () => {
    const projectId = await createProject()
    const now = Date.now()
    const firstId = await db.historicalTimelineEvents.add({
      projectId,
      era: 'custom',
      year: 1,
      date: '元年',
      title: '开国',
      description: '旧定稿',
      isHistorical: false,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const secondId = await db.historicalTimelineEvents.add({
      projectId,
      era: 'custom',
      year: 2,
      date: '二年',
      title: '迁都',
      description: '另一条定稿',
      isHistorical: false,
      createdAt: now,
      updatedAt: now,
    } as any) as number

    const result = await adopt({
      projectId,
      target: 'historicalTimelineEvents',
      mode: 'replace',
      recordId: firstId,
      data: { aiConsult: '## 考据结果\n称谓需要调整。' },
    })

    expect(result.written).toHaveLength(1)
    expect((await db.historicalTimelineEvents.get(firstId))?.aiConsult).toContain('称谓需要调整')
    expect((await db.historicalTimelineEvents.get(firstId))?.description).toBe('旧定稿')
    expect((await db.historicalTimelineEvents.get(secondId))?.aiConsult).toBeUndefined()
  })

  it('集合定点写回:世界地图 Agent 将对象配置规范化为 JSON 字符串', async () => {
    const projectId = await createProject()
    const now = Date.now()
    const nodeId = await db.worldNodes.add({
      projectId,
      parentId: null,
      name: '九州',
      description: '主世界',
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    } as any) as number

    const result = await adopt({
      projectId,
      target: 'worldNodes',
      mode: 'replace',
      recordId: nodeId,
      data: {
        mapConfigJSON: {
          seed: 'jiuzhou',
          mapName: '九州',
          heightmapTemplate: 'continents',
          namingStyle: 'chinese',
        },
      },
    })

    expect(result.written).toHaveLength(1)
    expect(JSON.parse((await db.worldNodes.get(nodeId))?.mapConfigJSON || '{}')).toMatchObject({
      seed: 'jiuzhou',
      mapName: '九州',
    })
  })

  it('集合写回:世界地图 Agent 可以新增 parentId=null 的根世界', async () => {
    const projectId = await createProject()
    const result = await adopt({
      projectId,
      target: 'worldNodes',
      mode: 'add',
      data: {
        parentId: null,
        name: '九州',
        description: '主世界',
        sortOrder: 0,
        mapConfigJSON: { seed: 'jiuzhou', mapName: '九州' },
      },
    })

    expect(result.skipped).toHaveLength(0)
    const root = await db.worldNodes.where('projectId').equals(projectId).first()
    expect(root?.parentId).toBeNull()
    expect(JSON.parse(root?.mapConfigJSON || '{}').seed).toBe('jiuzhou')
  })

  it('集合写回:detailedOutlines 数组成员校验过滤不存在的角色 ID', async () => {
    const projectId = await createProject()
    const now = Date.now()
    const outlineNodeId = await db.outlineNodes.add({
      projectId,
      parentId: null,
      type: 'chapter',
      title: '第一章',
      summary: '',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const characterId = await db.characters.add({
      projectId,
      name: '沈璃',
      role: 'supporting',
      shortDescription: '',
      createdAt: now,
      updatedAt: now,
    } as any) as number

    const result = await adopt({
      projectId,
      target: 'detailedOutlines',
      mode: 'add',
      data: {
        outlineNodeId,
        scenes: [],
        appearingCharacterIds: [characterId, 9999],
      },
    })

    expect(result.fkErrors).toContainEqual({ field: 'appearingCharacterIds[]', refValue: 9999 })
    const row = await db.detailedOutlines.where('projectId').equals(projectId).first()
    expect(row?.appearingCharacterIds).toEqual([characterId])
  })
})
