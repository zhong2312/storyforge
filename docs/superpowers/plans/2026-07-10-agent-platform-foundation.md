# Agent Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the storage, Agent event, tool, runtime, and architecture-boundary contracts required by the approved Agent/MCP/dual-storage design without changing current user-visible behavior.

**Architecture:** Introduce StoryForge-owned ports before integrating AI SDK or Tauri. A memory storage adapter and in-memory Agent event log make the contracts executable and testable; existing Dexie and AI flows remain unchanged until later plans. Static architecture gates prevent new Agent code from bypassing the three registries or importing Zustand/Dexie directly.

**Tech Stack:** TypeScript 5.6, Vitest 2, Node.js architecture scripts, nanoid, existing React/Vite repository tooling.

---

## Scope and plan-series boundary

This is Plan 1 of the approved design. It intentionally stops before production adapters and UI work.

| Later plan | Depends on this plan | Deliverable |
|---|---|---|
| Storage/Dexie vertical slice | Storage ports + contract test harness | `worldviews`, `characters`, `chapters` through `DexieStorageAdapter` |
| Registry-driven internal tools | Tool contracts + storage ports | context read and plan/approval/commit adoption tools |
| Agent runtime and remote MCP | Agent events + runtime/tool ports | AI SDK runtime adapter and HTTP/SSE MCP |
| Agent Dock vertical slice | Agent events + first internal tools | right-side conversation, tool timeline, approval card |
| Tauri file storage and stdio MCP | storage contracts + MCP port | local project folder, journal, watcher, stdio transport |
| Full migration and background agents | all preceding plans | all project tables/AI buttons, then background and multi-Agent |

Do not add AI SDK, Tauri, MCP packages, local-file codecs, React components, or production Dexie routing in this plan.

## Known baseline gate

At plan-writing time, `npm test` has one pre-existing failure:

```text
tests/registry/ai-manual.test.ts
[ai-manual] 生成结果与已提交文件不一致
```

Implementation may proceed on targeted tests, but this plan is not merge-ready until a rebase or separate baseline repair makes the full test suite green. Do not hide, skip, or delete the failing test.

## Target file map

### Documentation
- Create `docs/adr/ADR-001-agent-runtime-port.md`.
- Create `docs/adr/ADR-002-single-active-storage-backend.md`.
- Create `docs/adr/ADR-003-agent-write-plan-approval-commit.md`.
- Modify `docs/AI-COPILOT-DESIGN.md`.

### Storage contracts
- Create `src/lib/storage/ports/project-locator.ts`.
- Create `src/lib/storage/ports/storage-query.ts`.
- Create `src/lib/storage/ports/storage-table.ts`.
- Create `src/lib/storage/ports/project-storage.ts`.
- Create `src/lib/storage/ports/index.ts`.
- Create `src/lib/storage/adapters/memory/memory-project-storage.ts`.
- Create `tests/storage/project-locator.test.ts`.
- Create `tests/storage/storage-contract.ts`.
- Create `tests/storage/memory-project-storage.test.ts`.

### Agent contracts
- Create `src/lib/agent/events/agent-events.ts`.
- Create `src/lib/agent/events/in-memory-agent-event-log.ts`.
- Create `src/lib/agent/runtime/agent-runtime-port.ts`.
- Create `src/lib/agent/tools/tool-types.ts`.
- Create `src/lib/agent/tools/tool-registry.ts`.
- Create `tests/agent/agent-event-log.test.ts`.
- Create `tests/agent/tool-registry.test.ts`.

### Architecture enforcement
- Modify `scripts/check-architecture.mjs`.
- Create `tests/architecture/agent-boundaries.test.ts`.

<hr />

## Task 1: Record architecture decisions and correct the Phase 27 design

**Files:**
- Create: `docs/adr/ADR-001-agent-runtime-port.md`
- Create: `docs/adr/ADR-002-single-active-storage-backend.md`
- Create: `docs/adr/ADR-003-agent-write-plan-approval-commit.md`
- Modify: `docs/AI-COPILOT-DESIGN.md:136-203`
- Modify: `docs/AI-COPILOT-DESIGN.md:360-379`

- [ ] **Step 1: Create ADR-001**

Create `docs/adr/ADR-001-agent-runtime-port.md`:

```markdown
# ADR-001: StoryForge-owned Agent runtime port

- Status: Accepted
- Date: 2026-07-10

## Context
StoryForge must support tool loops, approvals, MCP and future multi-Agent orchestration across Web/PWA and Tauri. Binding UI and domain code directly to one Agent SDK would make provider, browser and desktop migrations expensive.

## Decision
Define `AgentRuntimePort` as the only application-facing Agent runtime contract. Implement the first adapter with AI SDK after the contract foundation is merged. UI, internal tools and domain services must not import AI SDK runtime types. The port exposes `run`, `resume` and `cancel` as event-stream operations. Runtime output is represented by StoryForge `AgentEvent`, not provider message objects.

## Consequences
- AI SDK can be replaced or supplemented without rewriting domain tools or UI projections.
- Provider-specific tool and reasoning formats are normalized inside the adapter.
- The foundation plan adds no AI SDK dependency.
```

- [ ] **Step 2: Create ADR-002**

Create `docs/adr/ADR-002-single-active-storage-backend.md`:

```markdown
# ADR-002: One active storage backend per project

- Status: Accepted
- Date: 2026-07-10

## Context
Web projects currently use Dexie. Tauri projects need a local project directory. Long-term Dexie/file dual writes would create two competing truths and unsafe partial failures.

## Decision
Every opened project has one `ProjectLocator` and one active `ProjectStoragePort`. A project is either `dexie` or `local-folder` for the duration of a session. Conversion is an explicit validated migration that preserves the source until the user confirms the target. Mixed projects where some tables use Dexie and other tables use files are forbidden outside isolated adapter tests.

## Consequences
- Manual UI, Agent tools, lifecycle operations and exports eventually share one storage port.
- File storage is not released until all required lifecycle tables are covered.
- Migration and rollback remain explicit and testable.
```

- [ ] **Step 3: Create ADR-003**

Create `docs/adr/ADR-003-agent-write-plan-approval-commit.md`:

```markdown
# ADR-003: Agent writes use plan, approval and commit

- Status: Accepted
- Date: 2026-07-10

## Context
The existing `adopt()` path writes immediately. A conversational Agent must show the exact normalized change before modifying user data, and autonomous background agents must not silently edit manuscripts.

## Decision
Split Agent-facing writes into `planAdoption()` and `commitAdoption()`. Planning performs alias mapping, validation, identity resolution, FK checks, automatic stamps and diff generation without writing. Commit verifies plan expiry, project locator, base revision, approval hash and deterministic validators before writing in a transaction. Background agents can propose but do not receive the commit tool by default.

## Consequences
- Preview and commit use the same normalized plan.
- Stale plans fail instead of overwriting newer edits.
- Approval state becomes a persisted Agent concept.
```

- [ ] **Step 4: Correct AI-COPILOT-DESIGN**

Replace the paragraph below the tool-layer heading with:

```markdown
每个工具 = `{ name, description, parameters(JSON schema), risk, requiredScopes, execute(args) }`。工具分为 **StoryForge 内部工具** 与 **MCP 外部工具**；内部工具再分只读、生成、候选写入和提交。

工具层不能成为第四份业务事实源：Agent 读取必须委托 `CONTEXT_SOURCES + assembleContext()`，Agent 写入必须委托 `FIELD_REGISTRY + ADOPTION_SCHEMAS + planAdoption()/commitAdoption()`，表生命周期和存储 codec 必须来自 `PROJECT_TABLES`。工具不得直接读取 Zustand store、直接访问 `db.*`，也不得直接调用 Tauri 文件命令。
```

Replace the first MVP read/write tables with:

```markdown
| 工具 | 注册表/应用服务 | 说明 |
|------|----------------|------|
| `storyforge.project.inspect` | `CONTEXT_SOURCES` + project status service | 返回项目填写概况 |
| `storyforge.context.read` | `assembleContext()` | 按 sourceKeys 和作用域读取上下文 |
| `storyforge.settings.schema` | `FIELD_REGISTRY` + `ADOPTION_SCHEMAS` | 返回允许读写的结构 |
| `storyforge.settings.search` | registry-backed search service | 跨章节和设定搜索 |
```

```markdown
| 工具 | 注册表/应用服务 |
|------|----------------|
| `storyforge.change.propose` | `planAdoption()` |
| `storyforge.change.commit` | `commitAdoption()` |
| `storyforge.change.reject` | pending action service |
| `storyforge.change.undo` | adoption snapshot/inverse patch service |
```

Mark the existing domain-specific tool names as aliases built on these generic tools. Replace the Zustand row in section seven with:

```markdown
| Zustand store | 手动 UI 继续通过 store action 操作；Agent 工具只调用注册表应用服务，后续二者共同下沉到 `ProjectStoragePort` | 禁止 Agent 直接读写 store，避免 UI 状态成为第四份事实源 |
```

- [ ] **Step 5: Verify and commit documentation**

```powershell
rg -n "工具只调 store|写 store|直接读.*Store|直接写.*Store" docs/AI-COPILOT-DESIGN.md docs/adr
git add docs/adr docs/AI-COPILOT-DESIGN.md
git commit -m "docs(agent): record runtime storage and approval decisions"
```

Expected: no text authorizes Agent-to-store access; the commit succeeds.

<hr />

## Task 2: Define backend-neutral storage ports

**Files:**
- Create: `src/lib/storage/ports/project-locator.ts`
- Create: `src/lib/storage/ports/storage-query.ts`
- Create: `src/lib/storage/ports/storage-table.ts`
- Create: `src/lib/storage/ports/project-storage.ts`
- Create: `src/lib/storage/ports/index.ts`
- Create: `tests/storage/project-locator.test.ts`

- [ ] **Step 1: Write the failing locator test**

Create `tests/storage/project-locator.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { projectLocatorKey, sameProjectLocator, type ProjectLocator } from '../../src/lib/storage/ports/project-locator'

describe('ProjectLocator', () => {
  it('builds stable backend keys', () => {
    expect(projectLocatorKey({ backend: 'dexie', projectId: 12 })).toBe('dexie:12')
    expect(projectLocatorKey({ backend: 'local-folder', projectUuid: 'book-uuid', projectPath: 'F:/books/demo' })).toBe('local-folder:book-uuid')
  })

  it('compares logical identity instead of the current folder path', () => {
    const left: ProjectLocator = { backend: 'local-folder', projectUuid: 'book-uuid', projectPath: 'F:/books/demo' }
    const moved: ProjectLocator = { backend: 'local-folder', projectUuid: 'book-uuid', projectPath: 'G:/archive/demo' }
    expect(sameProjectLocator(left, moved)).toBe(true)
    expect(sameProjectLocator(left, { backend: 'dexie', projectId: 1 })).toBe(false)
  })
})
```

- [ ] **Step 2: Verify it fails**

```powershell
npx vitest run tests/storage/project-locator.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement storage port types**

Create `src/lib/storage/ports/project-locator.ts`:

```ts
export type ProjectLocator =
  | { backend: 'dexie'; projectId: number }
  | { backend: 'local-folder'; projectUuid: string; projectPath: string }

export function projectLocatorKey(locator: ProjectLocator): string {
  return locator.backend === 'dexie' ? `dexie:${locator.projectId}` : `local-folder:${locator.projectUuid}`
}

export function sameProjectLocator(left: ProjectLocator, right: ProjectLocator): boolean {
  return projectLocatorKey(left) === projectLocatorKey(right)
}
```

Create `src/lib/storage/ports/storage-query.ts`:

```ts
export type StorageScalar = string | number | boolean | null
export type StorageFilterValue = StorageScalar | StorageScalar[]
export interface StorageOrderBy { field: string; direction?: 'asc' | 'desc' }
export interface StorageQuery {
  where?: Record<string, StorageFilterValue>
  orderBy?: StorageOrderBy
  offset?: number
  limit?: number
}
```

Create `src/lib/storage/ports/storage-table.ts`:

```ts
import type { StorageQuery } from './storage-query'
export interface StorageRecord { id?: number }
export interface StorageTable<T extends StorageRecord> {
  get(id: number): Promise<T | undefined>
  list(query?: StorageQuery): Promise<T[]>
  findOne(query: StorageQuery): Promise<T | undefined>
  add(record: T): Promise<number>
  put(record: T): Promise<number>
  update(id: number, patch: Partial<T>): Promise<void>
  delete(id: number): Promise<void>
  bulkPut(records: T[]): Promise<void>
  bulkDelete(ids: number[]): Promise<void>
}
```

Create `src/lib/storage/ports/project-storage.ts`:

```ts
import type { ProjectLocator } from './project-locator'
import type { StorageRecord, StorageTable } from './storage-table'
export interface StorageCapabilities { transactions: boolean; atomicWrite: boolean; watch: boolean; localPaths: boolean; stdioMcp: boolean }
export interface StorageChange { table: string; ids: number[]; revision: string }
export type StorageChangeListener = (change: StorageChange) => void
export interface StorageTransaction { table<T extends StorageRecord>(name: string): StorageTable<T> }
export interface ProjectStoragePort extends StorageTransaction {
  readonly locator: ProjectLocator
  readonly capabilities: StorageCapabilities
  transaction<T>(mode: 'readonly' | 'readwrite', tables: string[], work: (transaction: StorageTransaction) => Promise<T>): Promise<T>
  getRevision(): Promise<string>
  flush(): Promise<void>
  close(): Promise<void>
  watch?(listener: StorageChangeListener): () => void
}
```

Create `src/lib/storage/ports/index.ts`:

```ts
export * from './project-locator'
export * from './storage-query'
export * from './storage-table'
export * from './project-storage'
```

- [ ] **Step 4: Verify and commit**

```powershell
npx vitest run tests/storage/project-locator.test.ts
npx tsc --noEmit
git add src/lib/storage/ports tests/storage/project-locator.test.ts
git commit -m "feat(storage): define backend-neutral project storage ports"
```

Expected: tests and typecheck PASS.
<hr />

## Task 3: Implement the memory storage reference adapter and contract suite

**Files:**
- Create: `src/lib/storage/adapters/memory/memory-project-storage.ts`
- Create: `tests/storage/storage-contract.ts`
- Create: `tests/storage/memory-project-storage.test.ts`

- [ ] **Step 1: Write the reusable contract first**

Create `tests/storage/storage-contract.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ProjectStoragePort } from '../../src/lib/storage/ports'

interface ExampleRecord {
  id?: number
  projectId: number
  worldGroupId?: number | null
  name: string
  order: number
}

export function runStorageContract(adapterName: string, createStorage: () => ProjectStoragePort): void {
  describe(`${adapterName} storage contract`, () => {
    it('supports CRUD', async () => {
      const storage = createStorage()
      const table = storage.table<ExampleRecord>('examples')
      const id = await table.add({ projectId: 1, name: 'alpha', order: 2 })
      expect(await table.get(id)).toMatchObject({ id, name: 'alpha' })
      await table.update(id, { name: 'beta' })
      expect(await table.get(id)).toMatchObject({ id, name: 'beta' })
      expect(await table.list({ where: { projectId: 1 } })).toHaveLength(1)
      await table.delete(id)
      expect(await table.get(id)).toBeUndefined()
      await storage.close()
    })

    it('supports filters, ordering, offset and limit', async () => {
      const storage = createStorage()
      const table = storage.table<ExampleRecord>('examples')
      await table.bulkPut([
        { projectId: 1, worldGroupId: null, name: 'c', order: 3 },
        { projectId: 1, worldGroupId: 9, name: 'a', order: 1 },
        { projectId: 1, worldGroupId: 9, name: 'b', order: 2 },
        { projectId: 2, worldGroupId: 9, name: 'ignored', order: 0 },
      ])
      const rows = await table.list({
        where: { projectId: 1, worldGroupId: [9] },
        orderBy: { field: 'order', direction: 'desc' },
        offset: 0,
        limit: 1,
      })
      expect(rows.map(row => row.name)).toEqual(['b'])
      expect(await table.findOne({ where: { name: 'a' } })).toMatchObject({ name: 'a' })
      await storage.close()
    })

    it('rolls back a failed readwrite transaction', async () => {
      const storage = createStorage()
      const table = storage.table<ExampleRecord>('examples')
      const initialRevision = await storage.getRevision()
      await expect(storage.transaction('readwrite', ['examples'], async tx => {
        await tx.table<ExampleRecord>('examples').add({ projectId: 1, name: 'temporary', order: 1 })
        throw new Error('abort transaction')
      })).rejects.toThrow('abort transaction')
      expect(await table.list()).toEqual([])
      expect(await storage.getRevision()).toBe(initialRevision)
      await storage.close()
    })

    it('rejects writes inside a readonly transaction', async () => {
      const storage = createStorage()
      const table = storage.table<ExampleRecord>('examples')
      await expect(storage.transaction('readonly', ['examples'], async tx => {
        await tx.table<ExampleRecord>('examples').add({ projectId: 1, name: 'forbidden', order: 1 })
      })).rejects.toThrow('readonly transaction modified data')
      expect(await table.list()).toEqual([])
      await storage.close()
    })

    it('increments revision after successful writes', async () => {
      const storage = createStorage()
      const table = storage.table<ExampleRecord>('examples')
      const before = await storage.getRevision()
      await table.add({ projectId: 1, name: 'alpha', order: 1 })
      expect(await storage.getRevision()).not.toBe(before)
      await storage.close()
    })
  })
}
```

Create `tests/storage/memory-project-storage.test.ts`:

```ts
import { MemoryProjectStorage } from '../../src/lib/storage/adapters/memory/memory-project-storage'
import { runStorageContract } from './storage-contract'

runStorageContract('memory', () => new MemoryProjectStorage({ backend: 'dexie', projectId: 1 }))
```

- [ ] **Step 2: Verify the adapter is missing**

```powershell
npx vitest run tests/storage/memory-project-storage.test.ts
```

Expected: FAIL because `memory-project-storage.ts` does not exist.

- [ ] **Step 3: Implement MemoryProjectStorage**

Create `src/lib/storage/adapters/memory/memory-project-storage.ts`:

```ts
import type {
  ProjectLocator,
  ProjectStoragePort,
  StorageCapabilities,
  StorageFilterValue,
  StorageQuery,
  StorageRecord,
  StorageTable,
  StorageTransaction,
} from '../../ports'

interface MemorySnapshot {
  tables: Map<string, Map<number, StorageRecord>>
  sequences: Map<string, number>
  revision: number
}

const cloneRecord = <T>(value: T): T => structuredClone(value)

function matchesFilter(actual: unknown, expected: StorageFilterValue): boolean {
  return Array.isArray(expected) ? expected.some(value => Object.is(actual, value)) : Object.is(actual, expected)
}

function applyQuery<T extends StorageRecord>(rows: T[], query?: StorageQuery): T[] {
  let result = rows
  if (query?.where) {
    result = result.filter(row => Object.entries(query.where!).every(
      ([field, expected]) => matchesFilter((row as Record<string, unknown>)[field], expected),
    ))
  }
  if (query?.orderBy) {
    const { field, direction = 'asc' } = query.orderBy
    const multiplier = direction === 'asc' ? 1 : -1
    result = [...result].sort((left, right) => {
      const a = (left as Record<string, unknown>)[field]
      const b = (right as Record<string, unknown>)[field]
      if (Object.is(a, b)) return 0
      if (a == null) return -1 * multiplier
      if (b == null) return 1 * multiplier
      if (typeof a === 'number' && typeof b === 'number') return (a - b) * multiplier
      return String(a).localeCompare(String(b)) * multiplier
    })
  }
  const offset = Math.max(0, query?.offset ?? 0)
  const end = query?.limit == null ? undefined : offset + Math.max(0, query.limit)
  return result.slice(offset, end)
}

export class MemoryProjectStorage implements ProjectStoragePort {
  readonly capabilities: StorageCapabilities = {
    transactions: true,
    atomicWrite: true,
    watch: false,
    localPaths: false,
    stdioMcp: false,
  }

  private tables = new Map<string, Map<number, StorageRecord>>()
  private sequences = new Map<string, number>()
  private revision = 0

  constructor(readonly locator: ProjectLocator) {}

  table<T extends StorageRecord>(name: string): StorageTable<T> {
    const records = () => {
      let table = this.tables.get(name)
      if (!table) {
        table = new Map<number, StorageRecord>()
        this.tables.set(name, table)
      }
      return table
    }
    const allocateId = () => {
      const next = (this.sequences.get(name) ?? 0) + 1
      this.sequences.set(name, next)
      return next
    }
    const markWrite = () => { this.revision += 1 }

    return {
      get: async id => {
        const record = records().get(id)
        return record ? cloneRecord(record as T) : undefined
      },
      list: async query => applyQuery(Array.from(records().values()).map(record => cloneRecord(record as T)), query),
      findOne: async query => applyQuery(Array.from(records().values()).map(record => cloneRecord(record as T)), { ...query, limit: 1 })[0],
      add: async record => {
        const id = record.id ?? allocateId()
        if (records().has(id)) throw new Error(`[memory-storage] duplicate id ${name}#${id}`)
        records().set(id, cloneRecord({ ...record, id }))
        this.sequences.set(name, Math.max(this.sequences.get(name) ?? 0, id))
        markWrite()
        return id
      },
      put: async record => {
        const id = record.id ?? allocateId()
        records().set(id, cloneRecord({ ...record, id }))
        this.sequences.set(name, Math.max(this.sequences.get(name) ?? 0, id))
        markWrite()
        return id
      },
      update: async (id, patch) => {
        const current = records().get(id)
        if (!current) throw new Error(`[memory-storage] missing ${name}#${id}`)
        records().set(id, cloneRecord({ ...current, ...patch, id }))
        markWrite()
      },
      delete: async id => { if (records().delete(id)) markWrite() },
      bulkPut: async input => {
        for (const record of input) {
          const id = record.id ?? allocateId()
          records().set(id, cloneRecord({ ...record, id }))
          this.sequences.set(name, Math.max(this.sequences.get(name) ?? 0, id))
        }
        if (input.length) markWrite()
      },
      bulkDelete: async ids => {
        let changed = false
        for (const id of ids) changed = records().delete(id) || changed
        if (changed) markWrite()
      },
    }
  }

  async transaction<T>(mode: 'readonly' | 'readwrite', _tables: string[], work: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    const snapshot = this.snapshot()
    try {
      const result = await work(this)
      if (mode === 'readonly' && this.revision !== snapshot.revision) {
        this.restore(snapshot)
        throw new Error('[memory-storage] readonly transaction modified data')
      }
      return result
    } catch (error) {
      this.restore(snapshot)
      throw error
    }
  }

  async getRevision(): Promise<string> { return `memory:${this.revision}` }
  async flush(): Promise<void> {}
  async close(): Promise<void> {}

  private snapshot(): MemorySnapshot {
    return {
      tables: new Map(Array.from(this.tables.entries()).map(([name, table]) => [
        name,
        new Map(Array.from(table.entries()).map(([id, record]) => [id, cloneRecord(record)])),
      ])),
      sequences: new Map(this.sequences),
      revision: this.revision,
    }
  }

  private restore(snapshot: MemorySnapshot): void {
    this.tables = snapshot.tables
    this.sequences = snapshot.sequences
    this.revision = snapshot.revision
  }
}
```

- [ ] **Step 4: Verify and commit**

```powershell
npx vitest run tests/storage/project-locator.test.ts tests/storage/memory-project-storage.test.ts
npx tsc --noEmit
git add src/lib/storage/adapters/memory tests/storage
git commit -m "test(storage): add portable storage contract and memory adapter"
```

Expected: 7 tests PASS and typecheck PASS.
<hr />

## Task 4: Define Agent events and enforce transitions

**Files:**
- Create: `src/lib/agent/events/agent-events.ts`
- Create: `src/lib/agent/events/in-memory-agent-event-log.ts`
- Create: `tests/agent/agent-event-log.test.ts`

- [ ] **Step 1: Write failing event-log tests**

Create `tests/agent/agent-event-log.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { InMemoryAgentEventLog } from '../../src/lib/agent/events/in-memory-agent-event-log'

describe('InMemoryAgentEventLog', () => {
  it('assigns ids and monotonic sequences', () => {
    const log = new InMemoryAgentEventLog()
    const started = log.append({ type: 'run.started', runId: 'run-1', conversationId: 'conversation-1', payload: { userMessage: 'hello' } })
    const phase = log.append({ type: 'phase.started', runId: 'run-1', conversationId: 'conversation-1', payload: { phase: 'planning', label: '规划任务' } })
    expect(started.id).toBeTruthy()
    expect(started.sequence).toBe(1)
    expect(phase.sequence).toBe(2)
    expect(log.list('run-1')).toEqual([started, phase])
  })

  it('requires a started tool call before completion', () => {
    const log = new InMemoryAgentEventLog()
    expect(() => log.append({
      type: 'tool.completed', runId: 'run-1', conversationId: 'conversation-1',
      payload: { toolCallId: 'tool-1', toolName: 'storyforge.context.read', summary: 'done' },
    })).toThrow('tool-1 has not started')
  })

  it('requires a pending approval before resolution', () => {
    const log = new InMemoryAgentEventLog()
    expect(() => log.append({
      type: 'approval.resolved', runId: 'run-1', conversationId: 'conversation-1',
      payload: { approvalId: 'approval-1', decision: 'approved' },
    })).toThrow('approval-1 is not pending')
  })

  it('rejects execution after a terminal event', () => {
    const log = new InMemoryAgentEventLog()
    log.append({ type: 'run.completed', runId: 'run-1', conversationId: 'conversation-1', payload: { summary: 'done' } })
    expect(() => log.append({
      type: 'phase.started', runId: 'run-1', conversationId: 'conversation-1',
      payload: { phase: 'late', label: '不应执行' },
    })).toThrow('run-1 is already terminal')
  })
})
```

- [ ] **Step 2: Verify missing modules**

```powershell
npx vitest run tests/agent/agent-event-log.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Define the event union**

Create `src/lib/agent/events/agent-events.ts`:

```ts
export interface BaseAgentEvent<Type extends string, Payload> {
  id: string
  type: Type
  runId: string
  conversationId: string
  sequence: number
  timestamp: number
  payload: Payload
}

export type AgentEvent =
  | BaseAgentEvent<'run.started', { userMessage: string }>
  | BaseAgentEvent<'phase.started', { phase: string; label: string }>
  | BaseAgentEvent<'phase.completed', { phase: string; summary?: string }>
  | BaseAgentEvent<'reasoning.summary.delta', { text: string }>
  | BaseAgentEvent<'reasoning.summary.completed', { text: string }>
  | BaseAgentEvent<'message.delta', { text: string }>
  | BaseAgentEvent<'message.completed', { text: string }>
  | BaseAgentEvent<'tool.requested', { toolCallId: string; toolName: string; summary: string }>
  | BaseAgentEvent<'tool.started', { toolCallId: string; toolName: string }>
  | BaseAgentEvent<'tool.progress', { toolCallId: string; message: string; percent?: number }>
  | BaseAgentEvent<'tool.completed', { toolCallId: string; toolName: string; summary: string }>
  | BaseAgentEvent<'tool.failed', { toolCallId: string; toolName: string; error: string }>
  | BaseAgentEvent<'approval.requested', { approvalId: string; planId: string; summary: string }>
  | BaseAgentEvent<'approval.resolved', { approvalId: string; decision: 'approved' | 'edited' | 'rejected' }>
  | BaseAgentEvent<'run.completed', { summary: string }>
  | BaseAgentEvent<'run.failed', { error: string }>
  | BaseAgentEvent<'run.cancelled', { reason?: string }>

export type NewAgentEvent = AgentEvent extends infer Event
  ? Event extends AgentEvent ? Omit<Event, 'id' | 'sequence' | 'timestamp'> : never
  : never

export function isTerminalAgentEvent(event: AgentEvent): boolean {
  return event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled'
}
```

- [ ] **Step 4: Implement the event log**

Create `src/lib/agent/events/in-memory-agent-event-log.ts`:

```ts
import { nanoid } from 'nanoid'
import { isTerminalAgentEvent, type AgentEvent, type NewAgentEvent } from './agent-events'

export class InMemoryAgentEventLog {
  private readonly events = new Map<string, AgentEvent[]>()

  append(input: NewAgentEvent): AgentEvent {
    const existing = this.events.get(input.runId) ?? []
    if (existing.some(isTerminalAgentEvent)) throw new Error(`[agent-events] ${input.runId} is already terminal`)
    this.validateTransition(existing, input)
    const event = { ...input, id: nanoid(), sequence: existing.length + 1, timestamp: Date.now() } as AgentEvent
    this.events.set(input.runId, [...existing, event])
    return event
  }

  list(runId: string): AgentEvent[] {
    return [...(this.events.get(runId) ?? [])]
  }

  private validateTransition(existing: AgentEvent[], input: NewAgentEvent): void {
    if (input.type === 'tool.completed' || input.type === 'tool.failed') {
      const started = existing.some(event => event.type === 'tool.started' && event.payload.toolCallId === input.payload.toolCallId)
      if (!started) throw new Error(`[agent-events] tool ${input.payload.toolCallId} has not started`)
    }
    if (input.type === 'approval.resolved') {
      const requested = existing.some(event => event.type === 'approval.requested' && event.payload.approvalId === input.payload.approvalId)
      const resolved = existing.some(event => event.type === 'approval.resolved' && event.payload.approvalId === input.payload.approvalId)
      if (!requested || resolved) throw new Error(`[agent-events] approval ${input.payload.approvalId} is not pending`)
    }
  }
}
```

- [ ] **Step 5: Verify and commit**

```powershell
npx vitest run tests/agent/agent-event-log.test.ts
npx tsc --noEmit
git add src/lib/agent/events tests/agent/agent-event-log.test.ts
git commit -m "feat(agent): define structured run events and transition log"
```

Expected: tests and typecheck PASS.

<hr />

## Task 5: Define the runtime port and permission-aware tool registry

**Files:**
- Create: `src/lib/agent/runtime/agent-runtime-port.ts`
- Create: `src/lib/agent/tools/tool-types.ts`
- Create: `src/lib/agent/tools/tool-registry.ts`
- Create: `tests/agent/tool-registry.test.ts`

- [ ] **Step 1: Write failing tool tests**

Create `tests/agent/tool-registry.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ToolRegistry } from '../../src/lib/agent/tools/tool-registry'
import type { StoryForgeTool, ToolExecutionContext, ToolScope } from '../../src/lib/agent/tools/tool-types'

function createContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    runId: 'run-1', conversationId: 'conversation-1',
    project: { backend: 'dexie', projectId: 1 }, platform: 'web',
    scopes: new Set<ToolScope>(['project:read']), signal: new AbortController().signal,
    ...overrides,
  }
}

function createTool(overrides: Partial<StoryForgeTool<{ value: string }, string>> = {}): StoryForgeTool<{ value: string }, string> {
  return {
    name: 'storyforge.test.read', title: '测试读取', description: '测试工具',
    inputSchema: { type: 'object' }, risk: 'read', availability: 'both',
    requiredScopes: ['project:read'], execute: vi.fn(async (_context, input) => input.value),
    ...overrides,
  }
}

describe('ToolRegistry', () => {
  it('rejects duplicate names', () => {
    const registry = new ToolRegistry()
    registry.register(createTool())
    expect(() => registry.register(createTool())).toThrow('duplicate tool storyforge.test.read')
  })

  it('filters by platform and scopes', () => {
    const registry = new ToolRegistry()
    registry.register(createTool())
    registry.register(createTool({ name: 'storyforge.desktop.write', availability: 'desktop', risk: 'write', requiredScopes: ['project:write'] }))
    expect(registry.listAvailable(createContext()).map(tool => tool.name)).toEqual(['storyforge.test.read'])
  })

  it('executes available tools and rejects unavailable tools', async () => {
    const registry = new ToolRegistry()
    registry.register(createTool())
    registry.register(createTool({ name: 'storyforge.desktop.write', availability: 'desktop', risk: 'write', requiredScopes: ['project:write'] }))
    await expect(registry.execute('storyforge.test.read', createContext(), { value: 'ok' })).resolves.toBe('ok')
    await expect(registry.execute('storyforge.desktop.write', createContext(), { value: 'blocked' })).rejects.toThrow('not available')
  })
})
```

- [ ] **Step 2: Verify missing modules**

```powershell
npx vitest run tests/agent/tool-registry.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Define tool contracts**

Create `src/lib/agent/tools/tool-types.ts`:

```ts
import type { ProjectLocator } from '../../storage/ports'
export type ToolRisk = 'read' | 'generate' | 'write' | 'destructive' | 'external'
export type ToolAvailability = 'web' | 'desktop' | 'both'
export type ToolScope = 'project:read' | 'project:write' | 'manuscript:write' | 'external:read' | 'external:write'
export interface ToolExecutionContext {
  runId: string
  conversationId: string
  project: ProjectLocator
  platform: 'web' | 'desktop'
  scopes: ReadonlySet<ToolScope>
  signal: AbortSignal
}
export interface StoryForgeTool<Input = unknown, Output = unknown> {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  risk: ToolRisk
  availability: ToolAvailability
  requiredScopes: ToolScope[]
  execute(context: ToolExecutionContext, input: Input): Promise<Output>
  summarizeInput?(input: Input): string
  summarizeOutput?(output: Output): string
}
```

- [ ] **Step 4: Implement ToolRegistry**

Create `src/lib/agent/tools/tool-registry.ts`:

```ts
import type { StoryForgeTool, ToolExecutionContext, ToolScope } from './tool-types'

const supportsPlatform = (availability: StoryForgeTool['availability'], platform: ToolExecutionContext['platform']) => availability === 'both' || availability === platform
const hasScopes = (required: ToolScope[], granted: ReadonlySet<ToolScope>) => required.every(scope => granted.has(scope))

export class ToolRegistry {
  private readonly tools = new Map<string, StoryForgeTool>()

  register(tool: StoryForgeTool): void {
    if (this.tools.has(tool.name)) throw new Error(`[tool-registry] duplicate tool ${tool.name}`)
    this.tools.set(tool.name, tool)
  }

  get(name: string): StoryForgeTool | undefined { return this.tools.get(name) }

  listAvailable(context: ToolExecutionContext): StoryForgeTool[] {
    return Array.from(this.tools.values()).filter(tool => supportsPlatform(tool.availability, context.platform) && hasScopes(tool.requiredScopes, context.scopes))
  }

  async execute<Input, Output>(name: string, context: ToolExecutionContext, input: Input): Promise<Output> {
    const tool = this.tools.get(name) as StoryForgeTool<Input, Output> | undefined
    if (!tool) throw new Error(`[tool-registry] unknown tool ${name}`)
    if (!supportsPlatform(tool.availability, context.platform) || !hasScopes(tool.requiredScopes, context.scopes)) {
      throw new Error(`[tool-registry] tool ${name} is not available`)
    }
    if (context.signal.aborted) throw new DOMException('Agent run aborted', 'AbortError')
    return tool.execute(context, input)
  }
}
```

- [ ] **Step 5: Define AgentRuntimePort**

Create `src/lib/agent/runtime/agent-runtime-port.ts`:

```ts
import type { AgentEvent } from '../events/agent-events'
import type { ProjectLocator } from '../../storage/ports'
export interface AgentScope {
  worldGroupId?: number | null
  outlineNodeId?: number | null
  chapterId?: number | null
  module?: string
  entityId?: string | number | null
  selection?: { text: string; from?: number; to?: number }
}
export interface AgentRunInput {
  conversationId: string
  project: ProjectLocator
  scope: AgentScope
  userMessage: string
  preferredAgent?: string
  modelProfile?: string
  maxSteps?: number
  tokenBudget?: number
}
export interface ApprovalDecision {
  approvalId: string
  decision: 'approved' | 'edited' | 'rejected'
  editedPlan?: Record<string, unknown>
}
export interface AgentRuntimePort {
  run(input: AgentRunInput): AsyncIterable<AgentEvent>
  resume(runId: string, decision?: ApprovalDecision): AsyncIterable<AgentEvent>
  cancel(runId: string): Promise<void>
}
```

- [ ] **Step 6: Verify and commit**

```powershell
npx vitest run tests/agent/agent-event-log.test.ts tests/agent/tool-registry.test.ts
npx tsc --noEmit
git add src/lib/agent/runtime src/lib/agent/tools tests/agent/tool-registry.test.ts
git commit -m "feat(agent): define runtime port and permission-aware tool registry"
```

Expected: tests and typecheck PASS.
<hr />

## Task 6: Add architecture gates for Agent boundaries

**Files:**
- Modify: `scripts/check-architecture.mjs`
- Create: `tests/architecture/agent-boundaries.test.ts`

- [ ] **Step 1: Write the boundary regression test**

Create `tests/architecture/agent-boundaries.test.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const agentRoot = path.join(root, 'src/lib/agent')

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(absolute)
    return /\.tsx?$/.test(entry.name) ? [absolute] : []
  })
}

const importSpecifiers = (source: string) => Array.from(source.matchAll(/from\s+['"]([^'"]+)['"]/g), match => match[1])
const isForbidden = (specifier: string) => {
  const normalized = specifier.replace(/\\/g, '/')
  return /(^|\/)stores(\/|$)/.test(normalized) || /(^|\/)db\/schema$/.test(normalized)
}

describe('Agent architecture boundaries', () => {
  it('does not import Zustand stores or the Dexie schema', () => {
    const violations = walk(agentRoot).flatMap(file => {
      const source = fs.readFileSync(file, 'utf8')
      return importSpecifiers(source).filter(isForbidden).map(specifier => `${path.relative(root, file)} -> ${specifier}`)
    })
    expect(violations).toEqual([])
  })
})
```

- [ ] **Step 2: Prove the test detects a violation**

Temporarily add this line to `src/lib/agent/tools/tool-registry.ts`:

```ts
import { db } from '../../db/schema'
```

Run:

```powershell
npx vitest run tests/architecture/agent-boundaries.test.ts
```

Expected: FAIL and list `tool-registry.ts -> ../../db/schema`.

Remove the temporary import and rerun. Expected: PASS.

- [ ] **Step 3: Add rule eight to check-architecture.mjs**

Add to the header checklist:

```js
 *   ⑧ Agent 层不得导入 Zustand stores 或 Dexie schema
```

Insert before `// ── 报告 ──`:

```js
// ── ⑧ Agent 层禁止绕过端口和三注册表 ──
const agentDir = path.join(root, 'src/lib/agent')
if (fs.existsSync(agentDir)) {
  for (const file of walk('src/lib/agent')) {
    const src = read(file)
    for (const match of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1].replace(/\\/g, '/')
      const importsStore = /(^|\/)stores(\/|$)/.test(specifier)
      const importsDbSchema = /(^|\/)db\/schema$/.test(specifier)
      if (importsStore || importsDbSchema) {
        violations.push(`[⑧Agent越层] ${file}: Agent 层不得导入 ${match[1]},应通过 Tool/Storage/Registry port`)
      }
    }
  }
}
```

- [ ] **Step 4: Verify and commit**

```powershell
npm run check:architecture
npx vitest run tests/architecture/agent-boundaries.test.ts
git add scripts/check-architecture.mjs tests/architecture/agent-boundaries.test.ts
git commit -m "chore(architecture): prevent Agent store and Dexie bypasses"
```

Expected: architecture command and test PASS.

<hr />

## Task 7: Run foundation verification and prepare the next-plan handoff

**Files:**
- Modify only when verification exposes a defect in files created by Tasks 1-6.

- [ ] **Step 1: Run all new tests together**

```powershell
npx vitest run tests/storage/project-locator.test.ts tests/storage/memory-project-storage.test.ts tests/agent/agent-event-log.test.ts tests/agent/tool-registry.test.ts tests/architecture/agent-boundaries.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run registry and architecture regressions**

```powershell
npx vitest run tests/registry/project-tables.test.ts tests/registry/assemble-context.test.ts tests/registry/adopt.test.ts
npm run check:architecture
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript and production build**

```powershell
npx tsc --noEmit
npm run build
```

Expected: PASS.

- [ ] **Step 4: Enforce the full-suite baseline gate**

```powershell
npm test
```

Expected before merge: PASS with zero failures.

If the only failure remains `tests/registry/ai-manual.test.ts`, stop the merge. Rebase onto an upstream baseline fix or execute a separately reviewed baseline-repair task that regenerates and reviews `docs/AI-FUNCTIONS-MANUAL.generated.md`. Do not alter the Agent foundation to mask the failure.

- [ ] **Step 5: Confirm scope**

```powershell
git diff upstream/main...HEAD --name-only
```

Expected changed paths are limited to:

```text
docs/adr/
docs/AI-COPILOT-DESIGN.md
src/lib/storage/ports/
src/lib/storage/adapters/memory/
src/lib/agent/events/
src/lib/agent/runtime/
src/lib/agent/tools/
scripts/check-architecture.mjs
tests/storage/
tests/agent/
tests/architecture/
```

No React component, Dexie schema, package dependency, Tauri, MCP or production AI-client change belongs in this plan.

- [ ] **Step 6: Lock the next-plan input**

The next implementation plan must use these exact exports:

```text
ProjectLocator
ProjectStoragePort
StorageTable
StorageQuery
MemoryProjectStorage
AgentEvent
NewAgentEvent
InMemoryAgentEventLog
AgentRuntimePort
StoryForgeTool
ToolExecutionContext
ToolRegistry
```

Its scope is the Dexie vertical slice for `worldviews`, `characters` and `chapters`, including the reusable storage contract against Dexie. Do not begin internal Agent tools until that slice is green.

- [ ] **Step 7: Commit verification corrections only when needed**

```powershell
git add docs/adr docs/AI-COPILOT-DESIGN.md src/lib/storage src/lib/agent scripts/check-architecture.mjs tests/storage tests/agent tests/architecture
git commit -m "fix(agent): address foundation verification findings"
```

If verification changed no files, do not create an empty commit.