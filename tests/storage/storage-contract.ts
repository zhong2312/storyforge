import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  ProjectStoragePort,
  StorageTable,
} from '../../src/lib/storage/ports'

interface ExampleRecord {
  id?: number
  projectId: number
  worldGroupId?: number | null
  name: string
  order: number
  payload?: unknown
}

const TABLE_NAME = 'examples'

export function runStorageContract(
  adapterName: string,
  createStorage: () => ProjectStoragePort,
): void {
  describe(`${adapterName} ProjectStoragePort contract`, () => {
    let storage: ProjectStoragePort
    let table: StorageTable<ExampleRecord>

    beforeEach(() => {
      storage = createStorage()
      table = storage.table<ExampleRecord>(TABLE_NAME)
    })

    afterEach(async () => {
      await storage.close()
    })

    it('supports add/get/update/list/delete CRUD', async () => {
      const id = await table.add({
        projectId: 1,
        worldGroupId: null,
        name: 'First',
        order: 1,
      })

      expect(id).toBe(1)
      expect(await table.get(id)).toEqual({
        id,
        projectId: 1,
        worldGroupId: null,
        name: 'First',
        order: 1,
      })

      await table.update(id, { name: 'Updated', order: 2 })
      expect(await table.list()).toEqual([{
        id,
        projectId: 1,
        worldGroupId: null,
        name: 'Updated',
        order: 2,
      }])

      await table.delete(id)
      expect(await table.get(id)).toBeUndefined()
      expect(await table.list()).toEqual([])
    })

    it('supports put upserts and rejects duplicate adds or missing updates', async () => {
      await table.put({ id: 7, projectId: 1, name: 'Created by put', order: 1 })
      await table.put({ id: 7, projectId: 1, name: 'Updated by put', order: 2 })

      expect(await table.get(7)).toMatchObject({
        id: 7,
        name: 'Updated by put',
        order: 2,
      })
      await expect(table.add({
        id: 7,
        projectId: 1,
        name: 'Duplicate',
        order: 3,
      })).rejects.toThrow()
      await expect(table.update(999, { name: 'Missing' })).rejects.toThrow()
    })

    it('supports bulkPut, filters, ordering, pagination, and findOne', async () => {
      await table.bulkPut([
        { id: 10, projectId: 1, worldGroupId: null, name: 'Gamma', order: 1 },
        { id: 11, projectId: 1, worldGroupId: 2, name: 'Alpha', order: 3 },
        { id: 12, projectId: 2, worldGroupId: 2, name: 'Beta', order: 2 },
        { projectId: 1, worldGroupId: 3, name: 'Delta', order: 4 },
      ])

      expect((await table.list({ where: { projectId: 1 } })).map(record => record.name))
        .toEqual(['Gamma', 'Alpha', 'Delta'])
      expect((await table.list({ where: { worldGroupId: [null, 2] } })).map(record => record.name))
        .toEqual(['Gamma', 'Alpha', 'Beta'])
      expect((await table.list({
        orderBy: { field: 'order', direction: 'desc' },
        offset: 1,
        limit: 2,
      })).map(record => record.name)).toEqual(['Alpha', 'Beta'])
      expect(await table.findOne({ where: { name: 'Alpha' } })).toMatchObject({
        id: 11,
        projectId: 1,
      })
    })

    it('orders nulls, numbers, and other scalar values consistently', async () => {
      await table.bulkPut([
        { id: 1, projectId: 1, worldGroupId: 10, name: 'Beta', order: 20 },
        { id: 2, projectId: 1, worldGroupId: null, name: 'Alpha', order: 3 },
        { id: 3, projectId: 1, worldGroupId: 2, name: 'Gamma', order: 100 },
      ])

      expect((await table.list({ orderBy: { field: 'worldGroupId' } })).map(record => record.id))
        .toEqual([2, 3, 1])
      expect((await table.list({ orderBy: { field: 'order' } })).map(record => record.id))
        .toEqual([2, 1, 3])
      expect((await table.list({ orderBy: { field: 'name', direction: 'desc' } })).map(record => record.id))
        .toEqual([3, 1, 2])
    })

    it('keeps generated ids above every id observed by bulkPut', async () => {
      await table.bulkPut([
        { id: 40, projectId: 1, name: 'Explicit', order: 1 },
        { projectId: 1, name: 'Generated in bulk', order: 2 },
      ])

      const id = await table.add({ projectId: 1, name: 'Generated after bulk', order: 3 })

      expect(id).toBe(42)
    })

    it('rolls back data and revision when a readwrite transaction fails', async () => {
      await table.add({ projectId: 1, name: 'Before', order: 1 })
      const revisionBefore = await storage.getRevision()

      await expect(storage.transaction('readwrite', [TABLE_NAME], async transaction => {
        await transaction.table<ExampleRecord>(TABLE_NAME).add({
          projectId: 1,
          name: 'Rolled back',
          order: 2,
        })
        throw new Error('force rollback')
      })).rejects.toThrow('force rollback')

      expect(await table.list()).toEqual([{
        id: 1,
        projectId: 1,
        name: 'Before',
        order: 1,
      }])
      expect(await storage.getRevision()).toBe(revisionBefore)
    })

    it('rejects every readonly mutator at its entry point, including no-op writes', async () => {
      const id = await table.add({ projectId: 1, name: 'Existing', order: 1 })
      const revisionBefore = await storage.getRevision()
      const readonlyWrites: Array<(txTable: StorageTable<ExampleRecord>) => Promise<unknown>> = [
        txTable => txTable.add({ projectId: 1, name: 'Add', order: 2 }),
        txTable => txTable.put({ id, projectId: 1, name: 'Existing', order: 1 }),
        txTable => txTable.update(id, { name: 'Existing' }),
        txTable => txTable.delete(999),
        txTable => txTable.bulkPut([{ id, projectId: 1, name: 'Existing', order: 1 }]),
        txTable => txTable.bulkDelete([999]),
      ]

      for (const write of readonlyWrites) {
        let continuedAfterWrite = false
        await expect(storage.transaction('readonly', [TABLE_NAME], async transaction => {
          await write(transaction.table<ExampleRecord>(TABLE_NAME))
          continuedAfterWrite = true
        })).rejects.toThrow()

        expect(continuedAfterWrite).toBe(false)
        expect(await table.list()).toEqual([{
          id,
          projectId: 1,
          name: 'Existing',
          order: 1,
        }])
        expect(await storage.getRevision()).toBe(revisionBefore)
      }
    })

    it('rejects nested transactions without preventing the outer transaction from committing', async () => {
      await storage.transaction('readwrite', [TABLE_NAME], async transaction => {
        await expect(storage.transaction('readwrite', [TABLE_NAME], async nested => {
          await nested.table<ExampleRecord>(TABLE_NAME).add({
            projectId: 1,
            name: 'Nested',
            order: 1,
          })
        })).rejects.toThrow()

        await transaction.table<ExampleRecord>(TABLE_NAME).add({
          projectId: 1,
          name: 'Outer',
          order: 2,
        })
      })

      expect((await table.list()).map(record => record.name)).toEqual(['Outer'])
    })

    it('rejects overlapping transactions and root writes without clobbering committed data', async () => {
      await table.add({ projectId: 1, name: 'Committed before transaction', order: 1 })
      const entered = createDeferred()
      const release = createDeferred()
      const activeTransaction = storage.transaction('readwrite', [TABLE_NAME], async transaction => {
        await transaction.table<ExampleRecord>(TABLE_NAME).add({
          projectId: 1,
          name: 'Rolled back transaction write',
          order: 2,
        })
        entered.resolve()
        await release.promise
        throw new Error('rollback active transaction')
      })

      await entered.promise
      const overlappingTransaction = storage.transaction('readwrite', [TABLE_NAME], async transaction => {
        await transaction.table<ExampleRecord>(TABLE_NAME).add({
          projectId: 1,
          name: 'Overlapping transaction write',
          order: 3,
        })
      })
      const rootWrite = table.add({
        projectId: 1,
        name: 'Root write during transaction',
        order: 4,
      })
      release.resolve()

      const [activeResult, overlappingResult, rootWriteResult] = await Promise.allSettled([
        activeTransaction,
        overlappingTransaction,
        rootWrite,
      ])

      expect(activeResult.status).toBe('rejected')
      expect(overlappingResult.status).toBe('rejected')
      expect(rootWriteResult.status).toBe('rejected')
      expect((await table.list()).map(record => record.name)).toEqual(['Committed before transaction'])
      expect(await table.add({ projectId: 1, name: 'After rollback', order: 5 })).toBe(2)
    })

    it('keeps bulkPut data, revision, and sequence unchanged when cloning fails', async () => {
      await table.add({ projectId: 1, name: 'Before bulk failure', order: 1 })
      const revisionBefore = await storage.getRevision()

      await expect(table.bulkPut([
        { id: 10, projectId: 1, name: 'Must not persist', order: 2 },
        {
          projectId: 1,
          name: 'Clone failure',
          order: 3,
          payload: () => 'not cloneable',
        },
      ])).rejects.toThrow()

      expect((await table.list()).map(record => record.name)).toEqual(['Before bulk failure'])
      expect(await storage.getRevision()).toBe(revisionBefore)
      expect(await table.add({ projectId: 1, name: 'Next id', order: 4 })).toBe(2)
    })

    it('surfaces structuredClone failures as asynchronous rejections', async () => {
      const result = table.add({
        projectId: 1,
        name: 'Clone failure',
        order: 1,
        payload: () => 'not cloneable',
      })

      expect(result).toBeInstanceOf(Promise)
      await expect(result).rejects.toThrow()
      expect(await table.list()).toEqual([])
    })

    it('restricts transaction facades to their declared tables', async () => {
      await storage.transaction('readonly', [TABLE_NAME], async transaction => {
        expect(() => transaction.table<ExampleRecord>('undeclared')).toThrow()
        expect(await transaction.table<ExampleRecord>(TABLE_NAME).list()).toEqual([])
      })
    })

    it('changes revision for executed put, update, and non-empty bulkPut writes', async () => {
      const id = await table.add({ projectId: 1, name: 'Written', order: 1 })
      const afterAdd = await storage.getRevision()

      await table.put({ id, projectId: 1, name: 'Written', order: 1 })
      const afterPut = await storage.getRevision()
      expect(afterPut).not.toBe(afterAdd)

      await table.update(id, { name: 'Written' })
      const afterUpdate = await storage.getRevision()
      expect(afterUpdate).not.toBe(afterPut)

      await table.bulkPut([{ id, projectId: 1, name: 'Written', order: 1 }])
      expect(await storage.getRevision()).not.toBe(afterUpdate)
    })

    it('does not change revision after no-op delete operations', async () => {
      const revisionBefore = await storage.getRevision()

      await table.delete(100)
      await table.bulkDelete([200])

      expect(await storage.getRevision()).toBe(revisionBefore)
    })

    it('keeps watch capability and method availability consistent', () => {
      if (storage.capabilities.watch) {
        expect(storage.watch).toBeTypeOf('function')
      } else {
        expect(storage.watch).toBeUndefined()
      }
    })

    it('does not leak mutable references through inputs or outputs', async () => {
      const input: ExampleRecord = {
        projectId: 1,
        worldGroupId: null,
        name: 'Original',
        order: 1,
      }
      const id = await table.add(input)
      input.name = 'Mutated input'

      const fetched = await table.get(id)
      expect(fetched?.name).toBe('Original')
      if (fetched) {
        fetched.name = 'Mutated get result'
      }

      const listed = await table.list()
      listed[0].name = 'Mutated list result'

      expect((await table.get(id))?.name).toBe('Original')
    })
  })
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise!: () => void
  const promise = new Promise<void>(resolve => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}
