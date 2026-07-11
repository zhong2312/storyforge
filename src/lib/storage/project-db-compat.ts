import type { Table } from 'dexie'
import { db as dexieDb } from '../db/schema'
import { getActiveProjectStorage } from './application-project-storage'
import type { ProjectStoragePort, StorageRecord, StorageTable, StorageTransaction } from './ports'

type Row = StorageRecord & Record<string, any>
type Predicate<T> = (row: T) => boolean

let activeTransaction: { storage: ProjectStoragePort; transaction: StorageTransaction } | null = null

class CompatCollection<T extends Row> {
  private predicates: Predicate<T>[] = []
  private sortField?: string
  private descending = false

  constructor(
    private readonly table: CompatTable<T>,
    field?: string,
    values?: unknown[],
  ) {
    if (field && values) this.predicates.push(row => values.some(value => Object.is(row[field], value)))
  }

  equals(value: unknown): CompatCollection<T> {
    return this.cloneWith(row => Object.is(row[this.table.indexField], value))
  }

  anyOf(values: readonly unknown[]): CompatCollection<T> {
    return this.cloneWith(row => values.some(value => Object.is(row[this.table.indexField], value)))
  }

  and(predicate: Predicate<T>): CompatCollection<T> { return this.cloneWith(predicate) }
  filter(predicate: Predicate<T>): CompatCollection<T> { return this.cloneWith(predicate) }

  reverse(): CompatCollection<T> {
    const clone = this.copy()
    clone.descending = !clone.descending
    return clone
  }

  async toArray(): Promise<T[]> {
    let rows = await this.table.allRows()
    for (const predicate of this.predicates) rows = rows.filter(predicate)
    if (this.sortField) rows.sort((a, b) => compare(a[this.sortField!], b[this.sortField!]))
    if (this.descending) rows.reverse()
    return rows
  }

  async first(): Promise<T | undefined> { return (await this.toArray())[0] }
  async last(): Promise<T | undefined> {
    const rows = await this.toArray()
    return rows[rows.length - 1]
  }
  async count(): Promise<number> { return (await this.toArray()).length }
  async primaryKeys(): Promise<number[]> {
    return (await this.toArray()).flatMap(row => row.id == null ? [] : [row.id])
  }
  async delete(): Promise<number> {
    const ids = await this.primaryKeys()
    if (ids.length) await this.table.bulkDelete(ids)
    return ids.length
  }
  async sortBy(field: string): Promise<T[]> {
    const clone = this.copy()
    clone.sortField = field
    return clone.toArray()
  }

  private cloneWith(predicate: Predicate<T>): CompatCollection<T> {
    const clone = this.copy()
    clone.predicates.push(predicate)
    return clone
  }

  private copy(): CompatCollection<T> {
    const clone = new CompatCollection<T>(this.table)
    clone.predicates = [...this.predicates]
    clone.sortField = this.sortField
    clone.descending = this.descending
    return clone
  }
}

class CompatTable<T extends Row> {
  readonly __tableName: string
  readonly name: string
  indexField = ''

  constructor(name: string) {
    this.__tableName = name
    this.name = name
  }

  where(field: string): CompatCollection<T> {
    const table = new CompatTable<T>(this.__tableName)
    table.indexField = field
    return new CompatCollection(table)
  }

  orderBy(field: string): CompatCollection<T> {
    const collection = new CompatCollection<T>(this)
    return Object.assign(collection, { sortField: field })
  }

  filter(predicate: Predicate<T>): CompatCollection<T> {
    return new CompatCollection<T>(this).filter(predicate)
  }

  async toArray(): Promise<T[]> { return this.allRows() }
  async count(): Promise<number> { return (await this.allRows()).length }
  async get(id: number): Promise<T | undefined> { return (await this.storageTable()).get(id) as Promise<T | undefined> }
  async add(row: T): Promise<number> { return (await this.storageTable(row.projectId)).add(row) }
  async put(row: T): Promise<number> { return (await this.storageTable(row.projectId)).put(row) }
  async update(id: number, patch: Partial<T>): Promise<number> {
    await (await this.storageTable()).update(id, patch)
    return 1
  }
  async delete(id: number): Promise<void> { await (await this.storageTable()).delete(id) }
  async bulkDelete(ids: number[]): Promise<void> { await (await this.storageTable()).bulkDelete(ids) }
  async bulkPut(rows: T[]): Promise<void> { await (await this.storageTable(rows[0]?.projectId)).bulkPut(rows) }
  async bulkAdd(rows: T[]): Promise<number> {
    let last = 0
    for (const row of rows) last = await this.add(row)
    return last
  }
  async bulkUpdate(
    patches: Array<{ key: number; changes: Partial<T> }>,
  ): Promise<number> {
    for (const patch of patches) await this.update(patch.key, patch.changes)
    return patches.length
  }
  async bulkGet(ids: number[]): Promise<Array<T | undefined>> {
    return await Promise.all(ids.map(id => this.get(id)))
  }
  async primaryKeys(): Promise<number[]> {
    return (await this.allRows()).flatMap(row => row.id == null ? [] : [row.id])
  }

  async allRows(): Promise<T[]> {
    const active = activeTransaction?.transaction.table<T>(this.__tableName)
      ?? getActiveProjectStorage()?.table<T>(this.__tableName)
    if (active) return active.list()
    return await rawTable<T>(this.__tableName).toArray()
  }

  private async storageTable(projectId?: number): Promise<StorageTable<T>> {
    if (activeTransaction) return activeTransaction.transaction.table<T>(this.__tableName)
    const active = getActiveProjectStorage(projectId)
    if (active) return active.table<T>(this.__tableName)
    return rawTable<T>(this.__tableName) as unknown as StorageTable<T>
  }
}

const tableCache = new Map<string, CompatTable<Row>>()

function compatTable(name: string): CompatTable<Row> {
  let table = tableCache.get(name)
  if (!table) {
    table = new CompatTable(name)
    tableCache.set(name, table)
  }
  return table
}

function rawTable<T extends Row>(name: string): Table<T, number> {
  return dexieDb.table<T, number>(name)
}

function compare(left: unknown, right: unknown): number {
  if (Object.is(left, right)) return 0
  if (left == null) return -1
  if (right == null) return 1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}

const facade = new Proxy({} as typeof dexieDb, {
  get(_target, property) {
    if (property === 'transaction') {
      return async (_mode: string, ...args: unknown[]) => {
        const work = args.pop() as () => Promise<unknown>
        const names = flatten(args).map(value => tableName(value)).filter((name): name is string => Boolean(name))
        const storage = getActiveProjectStorage()
        if (!storage) {
          const tables = names.map(name => rawTable(name))
          return dexieDb.transaction(_mode as 'r' | 'rw', tables, work)
        }
        return storage.transaction(_mode === 'r' ? 'readonly' : 'readwrite', names, async transaction => {
          if (activeTransaction) throw new Error('[project-db-compat] nested or concurrent transaction is not supported')
          activeTransaction = { storage, transaction }
          try { return await work() } finally { activeTransaction = null }
        })
      }
    }
    if (typeof property === 'string' && dexieDb.tables.some(table => table.name === property)) {
      return compatTable(property)
    }
    return Reflect.get(dexieDb, property, dexieDb)
  },
})

function flatten(values: unknown[]): unknown[] {
  return values.flatMap(value => Array.isArray(value) ? flatten(value) : [value])
}

function tableName(value: unknown): string | undefined {
  if (value && typeof value === 'object' && '__tableName' in value) return String(Reflect.get(value, '__tableName'))
  if (value && typeof value === 'object' && 'name' in value) return String(Reflect.get(value, 'name'))
  return undefined
}

export const projectDb = facade
