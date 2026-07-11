import type {
  ProjectLocator,
  ProjectStoragePort,
  StorageCapabilities,
  StorageQuery,
  StorageRecord,
  StorageTable,
  StorageTransaction,
} from '../../ports'

const MEMORY_CAPABILITIES = Object.freeze({
  transactions: true,
  atomicWrite: true,
  watch: false,
  localPaths: false,
  stdioMcp: false,
} satisfies StorageCapabilities)

const READONLY_MODIFICATION_ERROR = 'readonly transaction modified data'
const ACTIVE_TRANSACTION_ERROR = 'transaction already active'
const EXTERNAL_WRITE_ERROR = 'storage modified outside active transaction'
const INACTIVE_TRANSACTION_ERROR = 'transaction is no longer active'

type TableRecords = Map<number, StorageRecord>
type TableCollection = Map<string, TableRecords>
type TransactionMode = 'readonly' | 'readwrite'

interface StorageSnapshot {
  tables: TableCollection
  sequences: Map<string, number>
  revision: number
}

interface TransactionContext {
  token: symbol
  mode: TransactionMode
  active: boolean
}

export class MemoryProjectStorage implements ProjectStoragePort {
  readonly locator: ProjectLocator
  readonly capabilities = MEMORY_CAPABILITIES

  private tables: TableCollection = new Map()
  private sequences = new Map<string, number>()
  private revision = 0
  private activeTransaction?: TransactionContext

  constructor(locator: ProjectLocator) {
    this.locator = Object.freeze(structuredClone(locator)) as ProjectLocator
  }

  table<T extends StorageRecord>(name: string): StorageTable<T> {
    return this.createTableFacade<T>(name)
  }

  async transaction<T>(
    mode: TransactionMode,
    tableNames: string[],
    work: (transaction: StorageTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.activeTransaction) {
      throw new Error(ACTIVE_TRANSACTION_ERROR)
    }

    const context: TransactionContext = { token: Symbol('memory transaction'), mode, active: true }
    // Memory adapter snapshots the whole in-memory store instead of only declared tables.
    // This keeps rollback simple for the test adapter; declared-table access is still enforced below.
    const snapshot = this.createSnapshot()
    const allowedTables = new Set(tableNames)
    const transaction: StorageTransaction = {
      table: <R extends StorageRecord>(name: string): StorageTable<R> => {
        this.assertTransactionIsActive(context)
        if (!allowedTables.has(name)) {
          throw new Error(`table is not part of transaction: ${name}`)
        }
        return this.createTableFacade<R>(name, context)
      },
    }

    this.activeTransaction = context
    try {
      return await work(transaction)
    } catch (error: unknown) {
      this.restoreSnapshot(snapshot)
      throw error
    } finally {
      context.active = false
      if (this.activeTransaction?.token === context.token) {
        this.activeTransaction = undefined
      }
    }
  }

  async getRevision(): Promise<string> {
    return `memory:${this.revision}`
  }

  async flush(): Promise<void> {
    // no-op
  }

  async close(): Promise<void> {
    // no-op
  }

  private createTableFacade<T extends StorageRecord>(
    name: string,
    context?: TransactionContext,
  ): StorageTable<T> {
    return {
      get: id => this.getRecord<T>(name, id, context),
      list: query => this.listRecords<T>(name, query, context),
      findOne: query => this.findOneRecord<T>(name, query, context),
      add: record => this.addRecord(name, record, context),
      put: record => this.putRecord(name, record, context),
      update: (id, patch) => this.updateRecord<T>(name, id, patch, context),
      delete: id => this.deleteRecord(name, id, context),
      bulkPut: records => this.bulkPutRecords(name, records, context),
      bulkDelete: ids => this.bulkDeleteRecords(name, ids, context),
    }
  }

  private async getRecord<T extends StorageRecord>(
    tableName: string,
    id: number,
    context?: TransactionContext,
  ): Promise<T | undefined> {
    this.assertTransactionIsActive(context)
    const record = this.tables.get(tableName)?.get(id)
    return record ? structuredClone(record as T) : undefined
  }

  private async listRecords<T extends StorageRecord>(
    tableName: string,
    query?: StorageQuery,
    context?: TransactionContext,
  ): Promise<T[]> {
    this.assertTransactionIsActive(context)
    const table = this.tables.get(tableName)
    if (!table) {
      return []
    }

    let records = Array.from(table.values(), record => record as T)
    const where = query?.where
    if (where) {
      records = records.filter(record => matchesWhere(record, where))
    }
    if (query?.orderBy) {
      const { field, direction = 'asc' } = query.orderBy
      const directionMultiplier = direction === 'desc' ? -1 : 1
      records.sort((left, right) => (
        compareValues(Reflect.get(left, field), Reflect.get(right, field)) * directionMultiplier
      ))
    }

    const offset = normalizeNonNegativeInteger(query?.offset)
    const limit = query?.limit === undefined
      ? records.length
      : normalizeNonNegativeInteger(query.limit)

    return records.slice(offset, offset + limit).map(record => structuredClone(record))
  }

  private async findOneRecord<T extends StorageRecord>(
    tableName: string,
    query: StorageQuery,
    context?: TransactionContext,
  ): Promise<T | undefined> {
    this.assertTransactionIsActive(context)
    const records = await this.listRecords<T>(tableName, query, context)
    return records[0]
  }

  private async addRecord<T extends StorageRecord>(
    tableName: string,
    record: T,
    context?: TransactionContext,
  ): Promise<number> {
    this.assertCanWrite(context)
    const table = this.getOrCreateTable(tableName)
    const id = record.id ?? this.nextId(tableName)

    if (table.has(id)) {
      throw new Error(`record already exists: ${tableName}:${id}`)
    }

    const storedRecord = cloneWithId(record, id)
    this.observeId(tableName, id)
    table.set(id, storedRecord)
    this.incrementRevision()
    return id
  }

  private async putRecord<T extends StorageRecord>(
    tableName: string,
    record: T,
    context?: TransactionContext,
  ): Promise<number> {
    this.assertCanWrite(context)
    const table = this.getOrCreateTable(tableName)
    const id = record.id ?? this.nextId(tableName)
    const storedRecord = cloneWithId(record, id)

    this.observeId(tableName, id)
    table.set(id, storedRecord)
    this.incrementRevision()
    return id
  }

  private async updateRecord<T extends StorageRecord>(
    tableName: string,
    id: number,
    patch: Partial<T>,
    context?: TransactionContext,
  ): Promise<void> {
    this.assertCanWrite(context)
    const table = this.tables.get(tableName)
    const previous = table?.get(id)
    if (!table || !previous) {
      throw new Error(`record not found: ${tableName}:${id}`)
    }

    const clonedPatch = structuredClone(patch)
    const updated = structuredClone(previous as T)
    Object.assign(updated, clonedPatch, { id })
    table.set(id, updated)
    this.incrementRevision()
  }

  private async deleteRecord(
    tableName: string,
    id: number,
    context?: TransactionContext,
  ): Promise<void> {
    this.assertCanWrite(context)
    const deleted = this.tables.get(tableName)?.delete(id) ?? false
    if (deleted) {
      this.incrementRevision()
    }
  }

  private async bulkPutRecords<T extends StorageRecord>(
    tableName: string,
    records: T[],
    context?: TransactionContext,
  ): Promise<void> {
    this.assertCanWrite(context)
    if (records.length === 0) {
      return
    }

    const existingTable = this.tables.get(tableName)
    const nextTable: TableRecords = existingTable
      ? new Map(Array.from(existingTable, ([id, record]) => [id, structuredClone(record)]))
      : new Map()
    let nextSequence = this.sequences.get(tableName) ?? 0

    for (const record of records) {
      const id = record.id ?? nextSequence + 1
      const storedRecord = cloneWithId(record, id)
      nextSequence = observeSequence(nextSequence, id)
      nextTable.set(id, storedRecord)
    }

    this.tables.set(tableName, nextTable)
    this.sequences.set(tableName, nextSequence)
    this.incrementRevision()
  }

  private async bulkDeleteRecords(
    tableName: string,
    ids: number[],
    context?: TransactionContext,
  ): Promise<void> {
    this.assertCanWrite(context)
    const table = this.tables.get(tableName)
    if (!table) {
      return
    }

    let changed = false
    for (const id of ids) {
      changed = table.delete(id) || changed
    }
    if (changed) {
      this.incrementRevision()
    }
  }

  private assertCanWrite(context?: TransactionContext): void {
    this.assertTransactionIsActive(context)
    if (context?.mode === 'readonly') {
      throw new Error(READONLY_MODIFICATION_ERROR)
    }
    if (this.activeTransaction && this.activeTransaction.token !== context?.token) {
      throw new Error(EXTERNAL_WRITE_ERROR)
    }
  }

  private assertTransactionIsActive(context?: TransactionContext): void {
    if (context && (!context.active || this.activeTransaction?.token !== context.token)) {
      throw new Error(INACTIVE_TRANSACTION_ERROR)
    }
  }

  private getOrCreateTable(tableName: string): TableRecords {
    const existing = this.tables.get(tableName)
    if (existing) {
      return existing
    }

    const created: TableRecords = new Map()
    this.tables.set(tableName, created)
    return created
  }

  private nextId(tableName: string): number {
    return (this.sequences.get(tableName) ?? 0) + 1
  }

  private observeId(tableName: string, id: number): void {
    this.sequences.set(tableName, observeSequence(this.sequences.get(tableName) ?? 0, id))
  }

  private incrementRevision(): void {
    this.revision += 1
  }

  private createSnapshot(): StorageSnapshot {
    return {
      tables: cloneTables(this.tables),
      sequences: new Map(this.sequences),
      revision: this.revision,
    }
  }

  private restoreSnapshot(snapshot: StorageSnapshot): void {
    this.tables = cloneTables(snapshot.tables)
    this.sequences = new Map(snapshot.sequences)
    this.revision = snapshot.revision
  }
}

function cloneWithId<T extends StorageRecord>(record: T, id: number): T {
  return Object.assign(structuredClone(record), { id })
}

function cloneTables(tables: TableCollection): TableCollection {
  return new Map(Array.from(tables, ([tableName, records]) => [
    tableName,
    new Map(Array.from(records, ([id, record]) => [id, structuredClone(record)])),
  ]))
}

function observeSequence(current: number, id: number): number {
  return id > current ? id : current
}

function matchesWhere(
  record: StorageRecord,
  where: NonNullable<StorageQuery['where']>,
): boolean {
  return Object.entries(where).every(([field, expected]) => {
    const actual: unknown = Reflect.get(record, field)
    const acceptedValues = Array.isArray(expected) ? expected : [expected]
    return acceptedValues.some(value => Object.is(actual, value))
  })
}

function compareValues(left: unknown, right: unknown): number {
  if (Object.is(left, right)) {
    return 0
  }
  if (left === null) {
    return -1
  }
  if (right === null) {
    return 1
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right
  }
  return String(left).localeCompare(String(right))
}

function normalizeNonNegativeInteger(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.trunc(value))
}
