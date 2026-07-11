import { projectScopedTables } from '../registry/lifecycle'
import type { ProjectStoragePort, StorageRecord } from './ports'

export interface StorageMigrationTableReport {
  readonly table: string
  readonly sourceCount: number
  readonly targetCount: number
  readonly sourceFingerprint: string
  readonly targetFingerprint: string
  readonly valid: boolean
}

export interface StorageMigrationReport {
  readonly sourceRevision: string
  readonly targetRevision: string
  readonly tables: readonly StorageMigrationTableReport[]
  readonly valid: boolean
}

export interface StorageMigrationOptions {
  readonly tableNames?: readonly string[]
  readonly requireEmptyTarget?: boolean
}

export async function migrateProjectStorage(
  source: ProjectStoragePort,
  target: ProjectStoragePort,
  options: StorageMigrationOptions = {},
): Promise<StorageMigrationReport> {
  const tableNames = [...new Set(options.tableNames ?? projectScopedTables().map(spec => spec.name))]
  const requireEmptyTarget = options.requireEmptyTarget ?? true
  const sourceRevision = await source.getRevision()
  const sourceRows = new Map<string, StorageRecord[]>()

  for (const tableName of tableNames) {
    const rows = await source.table(tableName).list()
    sourceRows.set(tableName, rows)
    if (requireEmptyTarget && (await target.table(tableName).list({ limit: 1 })).length > 0) {
      throw new Error(`[storage-migration] target table is not empty: ${tableName}`)
    }
  }

  await target.transaction('readwrite', tableNames, async transaction => {
    for (const tableName of tableNames) {
      const rows = sourceRows.get(tableName) ?? []
      if (rows.length > 0) await transaction.table(tableName).bulkPut(rows)
    }
  })
  await target.flush()

  const tables: StorageMigrationTableReport[] = []
  for (const tableName of tableNames) {
    const sourceTableRows = sourceRows.get(tableName) ?? []
    const targetTableRows = await target.table(tableName).list()
    const sourceFingerprint = await fingerprintRecords(sourceTableRows)
    const targetFingerprint = await fingerprintRecords(targetTableRows)
    tables.push({
      table: tableName,
      sourceCount: sourceTableRows.length,
      targetCount: targetTableRows.length,
      sourceFingerprint,
      targetFingerprint,
      valid: sourceTableRows.length === targetTableRows.length
        && sourceFingerprint === targetFingerprint,
    })
  }

  const report: StorageMigrationReport = {
    sourceRevision,
    targetRevision: await target.getRevision(),
    tables,
    valid: tables.every(table => table.valid),
  }
  if (!report.valid) {
    const invalid = report.tables.filter(table => !table.valid).map(table => table.table).join(', ')
    throw new Error(`[storage-migration] integrity verification failed: ${invalid}`)
  }
  if (await source.getRevision() !== sourceRevision) {
    throw new Error('[storage-migration] source changed during migration')
  }
  return report
}

async function fingerprintRecords(records: readonly StorageRecord[]): Promise<string> {
  const ordered = [...records].sort((left, right) => (left.id ?? 0) - (right.id ?? 0))
  const normalized = await Promise.all(ordered.map(record => normalizeValue(record)))
  const bytes = new TextEncoder().encode(stableStringify(normalized))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function normalizeValue(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer())
    return {
      $type: 'blob',
      mediaType: value.type,
      bytes: [...bytes],
    }
  }
  if (value instanceof Date) return { $type: 'date', value: value.toISOString() }
  if (Array.isArray(value)) return await Promise.all(value.map(normalizeValue))
  if (isRecord(value)) {
    const entries = await Promise.all(Object.keys(value).sort().map(async key => [key, await normalizeValue(value[key])] as const))
    return Object.fromEntries(entries)
  }
  return value
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
