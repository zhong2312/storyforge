import type { Table } from 'dexie'
import { db } from '../../../db/schema'
import { REGISTRY_BY_NAME } from '../../../registry/project-tables'
import type {
  ProjectLocator,
  ProjectStoragePort,
  StorageCapabilities,
  StorageQuery,
  StorageRecord,
  StorageTable,
  StorageTransaction,
} from '../../ports'

const DEXIE_CAPABILITIES = Object.freeze({
  transactions: true,
  atomicWrite: true,
  watch: false,
  localPaths: false,
  stdioMcp: false,
} satisfies StorageCapabilities)

type TransactionMode = 'readonly' | 'readwrite'

interface TransactionContext {
  readonly mode: TransactionMode
  readonly allowedTables: ReadonlySet<string>
  active: boolean
  dirty: boolean
}

export class DexieProjectStorage implements ProjectStoragePort {
  readonly locator: ProjectLocator
  readonly capabilities = DEXIE_CAPABILITIES

  constructor(locator: ProjectLocator) {
    if (locator.backend !== 'dexie') {
      throw new Error('[dexie-storage] requires a dexie project locator')
    }
    this.locator = Object.freeze(structuredClone(locator)) as ProjectLocator
  }

  table<T extends StorageRecord>(name: string): StorageTable<T> {
    this.resolveTable(name)
    return this.createTableFacade<T>(name)
  }

  async transaction<T>(
    mode: TransactionMode,
    tableNames: string[],
    work: (transaction: StorageTransaction) => Promise<T>,
  ): Promise<T> {
    const names = [...new Set(tableNames)]
    const tables = names.map(name => this.resolveTable(name))
    const projectTable = this.resolveTable('projects')
    const transactionTables = [...new Set([...tables, projectTable])]
    const context: TransactionContext = {
      mode,
      allowedTables: new Set(names),
      active: true,
      dirty: false,
    }

    try {
      return await db.transaction(mode === 'readonly' ? 'r' : 'rw', transactionTables, async () => {
        const transaction: StorageTransaction = {
          table: <R extends StorageRecord>(name: string): StorageTable<R> => {
            this.assertContext(context)
            if (!context.allowedTables.has(name)) {
              throw new Error(`[dexie-storage] table is not part of transaction: ${name}`)
            }
            return this.createTableFacade<R>(name, context)
          },
        }
        const result = await work(transaction)
        if (context.dirty) await this.touchProject()
        return result
      })
    } finally {
      context.active = false
    }
  }

  async getRevision(): Promise<string> {
    const project = await db.projects.get(this.projectId)
    if (!project) throw new Error(`[dexie-storage] project not found: ${this.projectId}`)
    return `dexie:${this.projectId}:${project.updatedAt}`
  }

  async flush(): Promise<void> {
    // IndexedDB transactions are durable when their promises resolve.
  }

  async close(): Promise<void> {
    // The application owns the shared StoryForge Dexie connection.
  }

  private get projectId(): number {
    if (this.locator.backend !== 'dexie') throw new Error('[dexie-storage] invalid locator')
    return this.locator.projectId
  }

  private resolveTable(name: string): Table<StorageRecord, number> {
    const spec = REGISTRY_BY_NAME.get(name)
    if (!spec) throw new Error(`[dexie-storage] unknown project table: ${name}`)
    if (spec.owner !== 'project') {
      throw new Error(`[dexie-storage] unsupported table ownership: ${name}:${spec.owner}`)
    }
    return spec.table as Table<StorageRecord, number>
  }

  private createTableFacade<T extends StorageRecord>(
    name: string,
    context?: TransactionContext,
  ): StorageTable<T> {
    return {
      get: id => this.getRecord<T>(name, id, context),
      list: query => this.listRecords<T>(name, query, context),
      findOne: query => this.findOneRecord<T>(name, query, context),
      add: record => this.write(name, context, () => this.addRecord(name, record)),
      put: record => this.write(name, context, () => this.putRecord(name, record)),
      update: (id, patch) => this.write(name, context, () => this.updateRecord(name, id, patch)),
      delete: async id => { await this.writeConditional(name, context, () => this.deleteRecord(name, id)) },
      bulkPut: records => this.write(name, context, () => this.bulkPutRecords(name, records)),
      bulkDelete: async ids => { await this.writeConditional(name, context, () => this.bulkDeleteRecords(name, ids)) },
    }
  }

  private async getRecord<T extends StorageRecord>(
    name: string,
    id: number,
    context?: TransactionContext,
  ): Promise<T | undefined> {
    this.assertContext(context)
    const record = await this.resolveTable(name).get(id)
    return record && this.belongsToProject(name, record) ? structuredClone(record as T) : undefined
  }

  private async listRecords<T extends StorageRecord>(
    name: string,
    query?: StorageQuery,
    context?: TransactionContext,
  ): Promise<T[]> {
    this.assertContext(context)
    const table = this.resolveTable(name)
    const records = name === 'projects'
      ? [await table.get(this.projectId)].filter((record): record is StorageRecord => Boolean(record))
      : await table.where('projectId').equals(this.projectId).toArray()
    return applyQuery(records as T[], query).map(record => structuredClone(record))
  }

  private async findOneRecord<T extends StorageRecord>(
    name: string,
    query: StorageQuery,
    context?: TransactionContext,
  ): Promise<T | undefined> {
    return (await this.listRecords<T>(name, { ...query, limit: 1 }, context))[0]
  }

  private async addRecord<T extends StorageRecord>(name: string, record: T): Promise<number> {
    const stored = this.stampProject(name, record)
    return await this.resolveTable(name).add(stored)
  }

  private async putRecord<T extends StorageRecord>(name: string, record: T): Promise<number> {
    const stored = this.stampProject(name, record)
    if (stored.id !== undefined) await this.assertPutTarget(name, stored.id)
    return await this.resolveTable(name).put(stored)
  }

  private async updateRecord<T extends StorageRecord>(
    name: string,
    id: number,
    patch: Partial<T>,
  ): Promise<void> {
    await this.assertOwnedRecord(name, id)
    const storedPatch = this.stampProject(name, patch as StorageRecord)
    delete storedPatch.id
    await this.resolveTable(name).update(id, storedPatch)
  }

  private async deleteRecord(name: string, id: number): Promise<boolean> {
    if (!await this.assertDeleteTarget(name, id)) return false
    await this.resolveTable(name).delete(id)
    return true
  }

  private async bulkPutRecords<T extends StorageRecord>(name: string, records: T[]): Promise<void> {
    for (const record of records) {
      if (record.id !== undefined) await this.assertPutTarget(name, record.id)
    }
    await this.resolveTable(name).bulkPut(records.map(record => this.stampProject(name, record)))
  }

  private async bulkDeleteRecords(name: string, ids: number[]): Promise<boolean> {
    const ownedIds: number[] = []
    for (const id of ids) {
      if (await this.assertDeleteTarget(name, id)) ownedIds.push(id)
    }
    await this.resolveTable(name).bulkDelete(ownedIds)
    return ownedIds.length > 0
  }

  private async write<T>(
    name: string,
    context: TransactionContext | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.assertCanWrite(context)
    if (context) {
      const result = await operation()
      context.dirty = true
      return result
    }

    return await db.transaction('rw', [this.resolveTable(name), this.resolveTable('projects')], async () => {
      const result = await operation()
      await this.touchProject()
      return result
    })
  }

  private async writeConditional(
    name: string,
    context: TransactionContext | undefined,
    operation: () => Promise<boolean>,
  ): Promise<void> {
    this.assertCanWrite(context)
    if (context) {
      if (await operation()) context.dirty = true
      return
    }

    await db.transaction('rw', [this.resolveTable(name), this.resolveTable('projects')], async () => {
      if (await operation()) await this.touchProject()
    })
  }

  private stampProject(name: string, record: StorageRecord): StorageRecord {
    const stored = structuredClone(record)
    if (name === 'projects') {
      if (stored.id !== undefined && stored.id !== this.projectId) {
        throw new Error(`[dexie-storage] cross-project write rejected: projects:${stored.id}`)
      }
      stored.id = this.projectId
      return stored
    }
    const suppliedProjectId = Reflect.get(stored, 'projectId')
    if (suppliedProjectId !== undefined && suppliedProjectId !== this.projectId) {
      throw new Error(`[dexie-storage] cross-project write rejected: ${name}:${String(suppliedProjectId)}`)
    }
    Reflect.set(stored, 'projectId', this.projectId)
    return stored
  }

  private belongsToProject(name: string, record: StorageRecord): boolean {
    return name === 'projects'
      ? record.id === this.projectId
      : Reflect.get(record, 'projectId') === this.projectId
  }

  private async assertOwnedRecord(name: string, id: number): Promise<void> {
    const record = await this.resolveTable(name).get(id)
    if (!record || !this.belongsToProject(name, record)) {
      throw new Error(`[dexie-storage] record not found in project: ${name}:${id}`)
    }
  }

  private async assertPutTarget(name: string, id: number): Promise<void> {
    const record = await this.resolveTable(name).get(id)
    if (record && !this.belongsToProject(name, record)) {
      throw new Error(`[dexie-storage] record not found in project: ${name}:${id}`)
    }
  }

  private async assertDeleteTarget(name: string, id: number): Promise<boolean> {
    const record = await this.resolveTable(name).get(id)
    if (!record) return false
    if (!this.belongsToProject(name, record)) {
      throw new Error(`[dexie-storage] record not found in project: ${name}:${id}`)
    }
    return true
  }

  private assertCanWrite(context?: TransactionContext): void {
    this.assertContext(context)
    if (context?.mode === 'readonly') {
      throw new Error('[dexie-storage] readonly transaction modified data')
    }
  }

  private assertContext(context?: TransactionContext): void {
    if (context && !context.active) {
      throw new Error('[dexie-storage] transaction is no longer active')
    }
  }

  private async touchProject(): Promise<void> {
    const project = await db.projects.get(this.projectId)
    if (!project) throw new Error(`[dexie-storage] project not found: ${this.projectId}`)
    await db.projects.update(this.projectId, {
      updatedAt: Math.max(Date.now(), project.updatedAt + 1),
    })
  }
}

function applyQuery<T extends StorageRecord>(records: T[], query?: StorageQuery): T[] {
  let result = [...records]
  if (query?.where) {
    result = result.filter(record => Object.entries(query.where ?? {}).every(([field, expected]) => {
      const accepted = Array.isArray(expected) ? expected : [expected]
      return accepted.some(value => Object.is(Reflect.get(record, field), value))
    }))
  }
  if (query?.orderBy) {
    const { field, direction = 'asc' } = query.orderBy
    const multiplier = direction === 'desc' ? -1 : 1
    result.sort((left, right) => compareValues(Reflect.get(left, field), Reflect.get(right, field)) * multiplier)
  }
  const offset = normalizeNonNegativeInteger(query?.offset)
  const limit = query?.limit === undefined ? result.length : normalizeNonNegativeInteger(query.limit)
  return result.slice(offset, offset + limit)
}

function compareValues(left: unknown, right: unknown): number {
  if (Object.is(left, right)) return 0
  if (left === null || left === undefined) return -1
  if (right === null || right === undefined) return 1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}

function normalizeNonNegativeInteger(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}
