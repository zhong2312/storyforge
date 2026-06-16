/**
 * R-export-derive-roundtrip · 派生引擎往返 + 旧格式向后兼容
 *
 * AUDIT-1 导入安全闸:
 * ① 派生导出 → 派生导入:全表行数一致 + 外键/树/世界组重映射正确。
 * ② 真实旧格式 fixture → 派生导入(已下载的旧备份 / Gist 旧存档能被新引擎读)。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { seedFullProject, EXPORTABLE_PROJECT_TABLES } from '../helpers/seed-full-project'
import { parseWorldPortals } from '../../src/lib/utils/world-portals'

const legacyFixturePath = path.resolve(__dirname, '../fixtures/legacy-export-v3.json')

async function tableCount(name: string, projectId: number): Promise<number> {
  return await (db as any)[name].where('projectId').equals(projectId).count()
}

/** 断言新项目每张项目级表行数与源一致 */
async function expectSameCounts(srcId: number, newId: number) {
  for (const name of EXPORTABLE_PROJECT_TABLES) {
    const a = await tableCount(name, srcId)
    const b = await tableCount(name, newId)
    expect(b, `表 ${name} 往返后行数应一致`).toBe(a)
  }
}

/** 断言新项目核心外键/树/世界组重映射正确 */
async function expectKeysRemapped(newId: number) {
  const groups = await db.worldGroups.where('projectId').equals(newId).sortBy('order')
  expect(groups).toHaveLength(2)
  const newWgA = groups[0].id!

  const outline = await db.outlineNodes.where('projectId').equals(newId).toArray()
  const vol = outline.find(n => n.type === 'volume')!
  const chapNode = outline.find(n => n.type === 'chapter')!
  expect(chapNode.parentId).toBe(vol.id)
  expect(chapNode.worldGroupId).toBe(newWgA)

  const chapter = await db.chapters.where('projectId').equals(newId).first()
  expect(chapter!.outlineNodeId).toBe(chapNode.id)
  expect(chapter!.content).toContain('废墟中睁眼')

  const cats = await db.codexCategories.where('projectId').equals(newId).toArray()
  const subCat = cats.find(c => c.name === '宗门')!
  expect(subCat.parentId).toBe(cats.find(c => c.name === '势力')!.id)
  const entry = await db.codexEntries.where('projectId').equals(newId).first()
  expect(entry!.categoryId).toBe(subCat.id)

  const worldNodes = await db.worldNodes.where('projectId').equals(newId).toArray()
  const root = worldNodes.find(n => n.name === '主世界')!
  const mirror = worldNodes.find(n => n.name === '镜界')!
  expect(mirror.parentId).toBe(root.id)
  const portals = parseWorldPortals(root.portalsJSON)
  expect(portals).toHaveLength(1)
  expect(portals[0].targetWorldId).toBe(mirror.id)
}

describe('R-export-derive-roundtrip · 派生往返 + 旧格式兼容', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('① 派生导出 → 派生导入:全表行数一致 + 外键重映射正确', async () => {
    const { projectId } = await seedFullProject()
    const exported = await exportProjectJSON(projectId)        // 现已转发到派生引擎
    const newId = await importProjectJSON(exported)
    expect(newId).not.toBe(projectId)
    await expectSameCounts(projectId, newId)
    await expectKeysRemapped(newId)
  })

  it('② 真实旧格式 fixture → 派生导入:外键/树/世界组重映射正确(旧备份兼容)', async () => {
    const legacy = JSON.parse(fs.readFileSync(legacyFixturePath, 'utf8'))
    const newId = await importProjectJSON(legacy)
    await expectKeysRemapped(newId)
    // fixture 即 seedFullProject 的导出,行数应与重新 seed 的源项目一致
    const { projectId: freshSrc } = await seedFullProject()
    await expectSameCounts(freshSrc, newId)
  })
})
