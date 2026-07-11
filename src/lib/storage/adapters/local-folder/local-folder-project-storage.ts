import { REGISTRY_BY_NAME } from '../../../registry/project-tables'
import type {
  ProjectFileSystemPort,
  ProjectLocator,
  ProjectStoragePort,
  StorageCapabilities,
  StorageQuery,
  StorageRecord,
  StorageTable,
  StorageTransaction,
} from '../../ports'

const STORE_PATH = '.storyforge/project-store.json'
const MANIFEST_PATH = 'storyforge.project.json'
const STORE_FORMAT = 'storyforge-local-project'
const STORE_VERSION = 1

interface LocalProjectState {
  readonly format: typeof STORE_FORMAT
  readonly version: typeof STORE_VERSION
  readonly projectUuid: string
  revision: number
  updatedAt: number
  tables: Record<string, StorageRecord[]>
  nextIds: Record<string, number>
}

interface TransactionContext {
  readonly mode: 'readonly' | 'readwrite'
  readonly allowedTables: ReadonlySet<string>
  readonly state: LocalProjectState
  active: boolean
  dirty: boolean
}

export interface LocalFolderProjectStorageOptions {
  readonly allowedTables?: readonly string[]
  readonly now?: () => number
}

export class LocalFolderProjectStorage implements ProjectStoragePort {
  readonly locator: ProjectLocator
  readonly capabilities: StorageCapabilities
  readonly #fileSystem: ProjectFileSystemPort
  readonly #allowedTables: ReadonlySet<string>
  readonly #now: () => number
  #state?: LocalProjectState
  #closed = false
  #activeTransaction = false
  #exclusiveTail: Promise<void> = Promise.resolve()

  constructor(
    locator: ProjectLocator,
    fileSystem: ProjectFileSystemPort,
    options: LocalFolderProjectStorageOptions = {},
  ) {
    if (locator.backend !== 'local-folder') {
      throw new Error('[local-folder-storage] requires a local-folder project locator')
    }
    this.locator = Object.freeze(structuredClone(locator)) as ProjectLocator
    this.#fileSystem = fileSystem
    this.#allowedTables = new Set(options.allowedTables ?? [...REGISTRY_BY_NAME.keys()])
    this.#now = options.now ?? Date.now
    this.capabilities = Object.freeze({
      transactions: true,
      atomicWrite: fileSystem.capabilities.atomicWrite,
      watch: false,
      localPaths: fileSystem.capabilities.localPaths,
      stdioMcp: false,
    })
  }

  table<T extends StorageRecord>(name: string): StorageTable<T> {
    this.assertTable(name)
    return this.createTableFacade<T>(name)
  }

  async transaction<T>(
    mode: 'readonly' | 'readwrite',
    tableNames: string[],
    work: (transaction: StorageTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.#activeTransaction) throw new Error('[local-folder-storage] transaction already active')
    this.#activeTransaction = true
    try {
      return await this.withExclusive(async () => {
      const names = [...new Set(tableNames)]
      names.forEach(name => this.assertTable(name))
      const state = cloneState(await this.loadState())
      const context: TransactionContext = {
        mode,
        allowedTables: new Set(names),
        state,
        active: true,
        dirty: false,
      }
      try {
        const result = await work({
          table: <R extends StorageRecord>(name: string): StorageTable<R> => {
            this.assertContext(context)
            if (!context.allowedTables.has(name)) {
              throw new Error(`[local-folder-storage] table is not part of transaction: ${name}`)
            }
            return this.createTableFacade<R>(name, context)
          },
        })
        if (context.dirty) await this.commitState(state)
        return result
      } finally {
        context.active = false
      }
      })
    } finally {
      this.#activeTransaction = false
    }
  }

  async getRevision(): Promise<string> {
    const state = await this.loadState()
    return `local-folder:${state.projectUuid}:${state.revision}`
  }

  async flush(): Promise<void> {
    await this.#exclusiveTail
  }

  async close(): Promise<void> {
    await this.flush()
    this.#closed = true
    this.#state = undefined
  }

  private createTableFacade<T extends StorageRecord>(
    name: string,
    context?: TransactionContext,
  ): StorageTable<T> {
    return {
      get: id => this.read(context, state => cloneRecord(this.rows<T>(state, name).find(row => row.id === id))),
      list: query => this.read(context, state => applyQuery(this.rows<T>(state, name), query).map(record => cloneStorageValue(record))),
      findOne: query => this.read(context, state => cloneRecord(applyQuery(this.rows<T>(state, name), { ...query, limit: 1 })[0])),
      add: record => this.write(context, state => this.addRecord(state, name, record)),
      put: record => this.write(context, state => this.putRecord(state, name, record)),
      update: (id, patch) => this.write(context, state => this.updateRecord(state, name, id, patch)),
      delete: id => this.writeConditional(context, state => this.deleteRecord(state, name, id)),
      bulkPut: records => this.write(context, async state => {
        for (const record of records) await this.putRecord(state, name, record)
      }),
      bulkDelete: ids => this.writeConditional(context, state => {
        const idSet = new Set(ids)
        const rows = this.rows(state, name)
        const filtered = rows.filter(row => !idSet.has(row.id ?? -1))
        if (filtered.length === rows.length) return false
        state.tables[name] = filtered
        return true
      }),
    }
  }

  private async read<T>(
    context: TransactionContext | undefined,
    operation: (state: LocalProjectState) => T | Promise<T>,
  ): Promise<T> {
    this.assertContext(context)
    return await operation(context?.state ?? await this.loadState())
  }

  private async write<T>(
    context: TransactionContext | undefined,
    operation: (state: LocalProjectState) => T | Promise<T>,
  ): Promise<T> {
    this.assertCanWrite(context)
    if (context) {
      const result = await operation(context.state)
      context.dirty = true
      return result
    }
    if (this.#activeTransaction) {
      throw new Error('[local-folder-storage] storage modified outside active transaction')
    }
    return await this.withExclusive(async () => {
      const state = cloneState(await this.loadState())
      const result = await operation(state)
      await this.commitState(state)
      return result
    })
  }

  private async writeConditional(
    context: TransactionContext | undefined,
    operation: (state: LocalProjectState) => boolean | Promise<boolean>,
  ): Promise<void> {
    this.assertCanWrite(context)
    if (context) {
      if (await operation(context.state)) context.dirty = true
      return
    }
    if (this.#activeTransaction) {
      throw new Error('[local-folder-storage] storage modified outside active transaction')
    }
    await this.withExclusive(async () => {
      const state = cloneState(await this.loadState())
      if (await operation(state)) await this.commitState(state)
    })
  }

  private rows<T extends StorageRecord>(state: LocalProjectState, name: string): T[] {
    return (state.tables[name] ??= []) as T[]
  }

  private addRecord<T extends StorageRecord>(state: LocalProjectState, name: string, record: T): number {
    if (record.id != null && this.rows(state, name).some(row => row.id === record.id)) {
      throw new Error(`[local-folder-storage] duplicate key: ${name}:${record.id}`)
    }
    const id = record.id ?? this.nextId(state, name)
    state.nextIds[name] = Math.max(state.nextIds[name] ?? 1, id + 1)
    this.rows(state, name).push({ ...cloneStorageValue(record), id })
    return id
  }

  private putRecord<T extends StorageRecord>(state: LocalProjectState, name: string, record: T): number {
    if (record.id == null) return this.addRecord(state, name, record)
    const rows = this.rows<T>(state, name)
    const index = rows.findIndex(row => row.id === record.id)
    const stored = cloneStorageValue(record)
    if (index >= 0) rows[index] = stored
    else rows.push(stored)
    state.nextIds[name] = Math.max(state.nextIds[name] ?? 1, record.id + 1)
    return record.id
  }

  private updateRecord<T extends StorageRecord>(
    state: LocalProjectState,
    name: string,
    id: number,
    patch: Partial<T>,
  ): void {
    const rows = this.rows<T>(state, name)
    const index = rows.findIndex(row => row.id === id)
    if (index < 0) throw new Error(`[local-folder-storage] record not found: ${name}:${id}`)
    rows[index] = { ...rows[index], ...cloneStorageValue(patch), id }
  }

  private deleteRecord(state: LocalProjectState, name: string, id: number): boolean {
    const rows = this.rows(state, name)
    const filtered = rows.filter(row => row.id !== id)
    if (filtered.length === rows.length) return false
    state.tables[name] = filtered
    return true
  }

  private nextId(state: LocalProjectState, name: string): number {
    const next = state.nextIds[name]
      ?? Math.max(0, ...this.rows(state, name).map(row => row.id ?? 0)) + 1
    state.nextIds[name] = next + 1
    return next
  }

  private async loadState(): Promise<LocalProjectState> {
    this.assertOpen()
    if (this.#state) return this.#state
    if (!await this.#fileSystem.exists(STORE_PATH)) {
      const state = this.emptyState()
      await this.persistState(state)
      this.#state = state
      return state
    }
    const decoded = await decodeJson(await this.#fileSystem.readText(STORE_PATH))
    this.#state = validateState(decoded, this.projectUuid)
    return this.#state
  }

  private async commitState(state: LocalProjectState): Promise<void> {
    state.revision += 1
    state.updatedAt = this.#now()
    await this.persistState(state)
    this.#state = state
  }

  private async persistState(state: LocalProjectState): Promise<void> {
    await this.#fileSystem.writeTextAtomic(STORE_PATH, await encodeJson(state))
    await this.#fileSystem.writeTextAtomic(MANIFEST_PATH, JSON.stringify({
      format: STORE_FORMAT,
      version: STORE_VERSION,
      projectUuid: state.projectUuid,
      revision: state.revision,
      updatedAt: state.updatedAt,
      store: STORE_PATH,
    }, null, 2))
  }

  private emptyState(): LocalProjectState {
    return {
      format: STORE_FORMAT,
      version: STORE_VERSION,
      projectUuid: this.projectUuid,
      revision: 0,
      updatedAt: this.#now(),
      tables: {},
      nextIds: {},
    }
  }

  private get projectUuid(): string {
    if (this.locator.backend !== 'local-folder') throw new Error('[local-folder-storage] invalid locator')
    return this.locator.projectUuid
  }

  private assertTable(name: string): void {
    this.assertOpen()
    if (!this.#allowedTables.has(name)) throw new Error(`[local-folder-storage] unknown project table: ${name}`)
  }

  private assertCanWrite(context?: TransactionContext): void {
    this.assertContext(context)
    if (context?.mode === 'readonly') throw new Error('[local-folder-storage] readonly transaction modified data')
  }

  private assertContext(context?: TransactionContext): void {
    this.assertOpen()
    if (context && !context.active) throw new Error('[local-folder-storage] transaction is no longer active')
  }

  private assertOpen(): void {
    if (this.#closed) throw new Error('[local-folder-storage] storage is closed')
  }

  private async withExclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.#exclusiveTail
    let release!: () => void
    this.#exclusiveTail = new Promise<void>(resolve => { release = resolve })
    await previous
    try {
      return await work()
    } finally {
      release()
    }
  }
}

function validateState(value: unknown, projectUuid: string): LocalProjectState {
  if (!isRecord(value)
    || value.format !== STORE_FORMAT
    || value.version !== STORE_VERSION
    || value.projectUuid !== projectUuid
    || typeof value.revision !== 'number'
    || !isRecord(value.tables)
    || !isRecord(value.nextIds)) {
    throw new Error('[local-folder-storage] invalid or mismatched project store')
  }
  return value as unknown as LocalProjectState
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
  if (left == null) return -1
  if (right == null) return 1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}

function normalizeNonNegativeInteger(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

function cloneRecord<T extends StorageRecord>(record: T | undefined): T | undefined {
  return record == null ? undefined : cloneStorageValue(record)
}

function cloneState(state: LocalProjectState): LocalProjectState {
  return cloneStorageValue(state)
}

function cloneStorageValue<T>(value: T): T {
  if (value instanceof Blob) return value.slice(0, value.size, value.type) as T
  if (value instanceof Date) return new Date(value.getTime()) as T
  if (Array.isArray(value)) return value.map(item => cloneStorageValue(item)) as T
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneStorageValue(item)])) as T
  }
  return structuredClone(value)
}

async function encodeJson(value: unknown): Promise<string> {
  return JSON.stringify(await encodeValue(value), null, 2)
}

async function encodeValue(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    return { $storyforgeType: 'blob', type: value.type, data: bytesToBase64(new Uint8Array(await value.arrayBuffer())) }
  }
  if (value instanceof Date) return { $storyforgeType: 'date', value: value.toISOString() }
  if (Array.isArray(value)) return await Promise.all(value.map(encodeValue))
  if (isRecord(value)) {
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await encodeValue(item)])))
  }
  return value
}

async function decodeJson(text: string): Promise<unknown> {
  return decodeValue(JSON.parse(text))
}

function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeValue)
  if (!isRecord(value)) return value
  if (value.$storyforgeType === 'blob' && typeof value.data === 'string') {
    const bytes = base64ToBytes(value.data)
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return new Blob([buffer], { type: typeof value.type === 'string' ? value.type : '' })
  }
  if (value.$storyforgeType === 'date' && typeof value.value === 'string') return new Date(value.value)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeValue(item)]))
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
