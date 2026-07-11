/**
 * 生命周期派生 API(Phase 1.1a)
 *
 * 全部从 PROJECT_TABLES 派生,不再手写表清单。
 *   - cascadeDeleteProject(projectId)
 *   - cascadeDeleteGroup(projectId, wgId)
 *   - stampPrimaryWorld(projectId, primaryId)
 *   - transactionTablesFor(operation)
 *
 * 设计依据:docs/MASTER-BLUEPRINT.md §5.1。
 *
 * ⚠️ Phase 1.1a 阶段:本文件【纯新增】,现有 stores 暂未切换调用。
 *    1.1b 才把 deleteProject/deleteGroup/migrate 改成调这里。
 */
import type { Table } from 'dexie'
import { projectDb as db } from '../storage/project-db-compat'
import { PROJECT_TABLES, REGISTRY_BY_NAME } from './project-tables'
import type { TableSpec } from './types'
import { getActiveProjectStorage } from '../storage/application-project-storage'

// ─────────────────────────────────────────────────────────────
// 派生选择器
// ─────────────────────────────────────────────────────────────

/** 参与删项目级联的表(project / direct-child / indirect / transient / blob,不含 global) */
export function projectScopedTables(): TableSpec[] {
  return PROJECT_TABLES.filter(s => s.owner !== 'global')
}

/** 带 worldGroupId 的表(多世界隔离 / 盖章 / 删世界级联) */
export function worldScopedTables(): TableSpec[] {
  return PROJECT_TABLES.filter(s => s.worldScoped)
}

/** 可导出表 */
export function exportableTables(): TableSpec[] {
  return PROJECT_TABLES.filter(s => s.exportable)
}

/**
 * 某个生命周期操作需要的 Dexie 事务表清单。
 * 防止"事务声明漏表"(Phase 0 反复踩的坑)。
 */
export function transactionTablesFor(
  op: 'deleteProject' | 'deleteGroup' | 'migrate' | 'importProject' | 'deleteChapters',
): Table[] {
  if (op === 'deleteProject' || op === 'importProject' || op === 'deleteChapters') {
    // 删项目/导入项目/删章节:所有非 global 表。导入与局部删除事务保持宽表声明,
    // 避免完整性断言或新增 project-scoped 表漏进事务。
    return projectScopedTables().map(s => s.table)
  }
  if (op === 'deleteGroup') {
    // 删世界组:所有 worldScoped 表 + 角色(homeWorldGroupId setNull)+ 大纲(worldGroupId setNull)+ 世界组本身
    const set = new Set<Table>(worldScopedTables().map(s => s.table))
    set.add(REGISTRY_BY_NAME.get('characters')!.table)
    set.add(REGISTRY_BY_NAME.get('outlineNodes')!.table)
    set.add(REGISTRY_BY_NAME.get('worldGroups')!.table)
    set.add(REGISTRY_BY_NAME.get('worldGroupLinks')!.table)
    return [...set]
  }
  // migrate:所有 worldScoped 表
  return worldScopedTables().map(s => s.table)
}

// ─────────────────────────────────────────────────────────────
// cascadeDeleteProject - 删项目级联清理(派生自注册表)
// ─────────────────────────────────────────────────────────────

export async function cascadeDeleteProject(projectId: number): Promise<void> {
  const activeStorage = getActiveProjectStorage(projectId)
  if (activeStorage?.locator.backend === 'local-folder') {
    const names = projectScopedTables().map(spec => spec.name)
    await activeStorage.transaction('readwrite', names, async transaction => {
      for (const name of names) {
        const table = transaction.table(name)
        const ids = (await table.list()).flatMap(row => row.id == null ? [] : [row.id])
        if (ids.length) await table.bulkDelete(ids)
      }
    })
    return
  }
  // ── Step 1:事务前预收集间接归属/blob 的父键 ──
  // (父表会在事务中被删,所以必须先把关联键拿到手)
  const indirectKeys = new Map<string, number[]>()
  for (const spec of projectScopedTables()) {
    if ((spec.owner === 'direct-child' || spec.owner === 'indirect') && spec.projectResolver) {
      indirectKeys.set(spec.name, await spec.projectResolver(projectId))
    }
  }
  // blob owner 父行(用于计算 blob key)
  const blobOwnerRows = new Map<string, any[]>()
  for (const spec of PROJECT_TABLES) {
    if (spec.refs?.some(r => r.kind === 'blob-owner')) {
      blobOwnerRows.set(spec.name, await lifecycleTable(spec).where('projectId').equals(projectId).toArray())
    }
  }
  const importSessionIds = (await db.importSessions
    .where('projectId').equals(projectId).primaryKeys()) as number[]

  // ── Step 2:事务内删除 ──
  await db.transaction('rw', transactionTablesFor('deleteProject'), async () => {
    for (const spec of projectScopedTables()) {
      if (spec.name === 'projects') continue // 根表最后删

      if (spec.owner === 'project' || spec.owner === 'transient') {
        await lifecycleTable(spec).where('projectId').equals(projectId).delete()
      } else if (spec.owner === 'direct-child' || spec.owner === 'indirect') {
        const parentKeys = indirectKeys.get(spec.name) ?? []
        const linkField = resolveLinkField(spec)
        if (parentKeys.length && linkField) {
          await lifecycleTable(spec).where(linkField).anyOf(parentKeys).delete()
        }
      } else if (spec.owner === 'blob') {
        await deleteBlobsInTransaction(importSessionIds, blobOwnerRows)
      }
    }
    await db.projects.delete(projectId) // 根表最后删
  })
}

/** 取间接归属表的关联字段名(从 indirect ref 里读;direct-child 用约定) */
function resolveLinkField(spec: TableSpec): string | null {
  for (const ref of spec.refs ?? []) {
    if (ref.kind === 'indirect') return ref.via.field
  }
  if (spec.name === 'referenceChunkAnalysis') return 'referenceId'
  return null
}

/** 事务内清理 blob(用预收集的数据,不重新查已被删的父表) */
async function deleteBlobsInTransaction(
  importSessionIds: number[],
  blobOwnerRows: Map<string, any[]>,
): Promise<void> {
  // (1) 普通导入 blob:importFiles 主键 = importSessions.id
  if (importSessionIds.length) await db.importFiles.bulkDelete(importSessionIds)

  // (2) blob-owner ref:用 keyResolver 计算 importFiles key(通用机制,当前无表使用)
  for (const spec of PROJECT_TABLES) {
    for (const ref of spec.refs ?? []) {
      if (ref.kind !== 'blob-owner') continue
      const owners = blobOwnerRows.get(spec.name) ?? []
      const keys = owners.map(row => ref.keyResolver(row)) as number[]
      if (keys.length) await db.importFiles.bulkDelete(keys)
      // 老式直接挂 importSessionId 的
      const legacy = owners
        .map(row => row.importSessionId)
        .filter((v: unknown): v is number => v != null)
      if (legacy.length) await db.importFiles.bulkDelete(legacy)
    }
  }
}

// ─────────────────────────────────────────────────────────────
// cascadeDeleteGroup - 删世界组级联清理(派生自注册表)
// ─────────────────────────────────────────────────────────────

export async function cascadeDeleteGroup(projectId: number, wgId: number): Promise<void> {
  await db.transaction('rw', transactionTablesFor('deleteGroup'), async () => {
    for (const spec of worldScopedTables()) {
      const wgField = spec.worldGroupField ?? 'worldGroupId'

      // codexCategories 特殊:内置分类(builtInKey 非空)保持全局,不按世界删
      if (spec.name === 'codexCategories') {
        const table = lifecycleTable(spec)
        const all = await table.where('projectId').equals(projectId).toArray()
        for (const row of all as any[]) {
          if (row[wgField] === wgId && !row.builtInKey) await table.delete(row.id)
        }
        continue
      }
      // outlineNodes 特殊:不删,只 setNull(卷脱离该世界)
      if (spec.name === 'outlineNodes') {
        const table = lifecycleTable(spec)
        const all = await table.where('projectId').equals(projectId).toArray()
        for (const row of all as any[]) {
          if (row[wgField] === wgId) await table.update(row.id, { [wgField]: null })
        }
        continue
      }

      const table = lifecycleTable(spec)
      const rows = await table.where('projectId').equals(projectId).toArray()
      for (const row of rows as any[]) {
        if (row[wgField] === wgId) await table.delete(row.id)
      }
    }

    // 角色 homeWorldGroupId setNull
    const chars = await db.characters.where('projectId').equals(projectId).toArray()
    for (const c of chars as any[]) {
      if (c.homeWorldGroupId === wgId) await db.characters.update(c.id, { homeWorldGroupId: null })
    }

    // 世界关系链接 + 世界组本身
    await db.worldGroupLinks.where('fromGroupId').equals(wgId).delete()
    await db.worldGroupLinks.where('toGroupId').equals(wgId).delete()
    await db.worldGroups.delete(wgId)
  })
}

// ─────────────────────────────────────────────────────────────
// stampPrimaryWorld - 开启多世界时盖章(派生自注册表)
// ─────────────────────────────────────────────────────────────

export async function stampPrimaryWorld(projectId: number, primaryId: number): Promise<void> {
  await db.transaction('rw', transactionTablesFor('migrate'), async () => {
    for (const spec of worldScopedTables()) {
      // codexCategories(分类结构)永远保持全局共用(内置 + 自定义都不盖章),
      // 只有「词条」codexEntries 才盖章归属主世界。与手写版 migrate 一致。
      if (spec.name === 'codexCategories') continue
      const wgField = spec.worldGroupField ?? 'worldGroupId'
      const table = lifecycleTable(spec)
      const rows = await table.where('projectId').equals(projectId).toArray()
      for (const row of rows as any[]) {
        if (row[wgField] == null) {
          await table.update(row.id, { [wgField]: primaryId })
        }
      }
    }
  })
}

function lifecycleTable(spec: TableSpec): any {
  return (db as unknown as Record<string, unknown>)[spec.name]
}
