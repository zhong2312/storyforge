import { describe, expect, it, vi } from 'vitest'
import { MemoryProjectStorage } from '../../src/lib/storage/adapters/memory/memory-project-storage'
import { ProjectStorageManager } from '../../src/lib/storage/project-storage-manager'

describe('ProjectStorageManager', () => {
  it('keeps exactly one active backend and closes the previous project', async () => {
    const manager = new ProjectStorageManager()
    const first = new MemoryProjectStorage({ backend: 'dexie', projectId: 1 })
    const second = new MemoryProjectStorage({ backend: 'dexie', projectId: 2 })
    const closeFirst = vi.spyOn(first, 'close')
    manager.register('dexie', async locator => locator.backend === 'dexie' && locator.projectId === 1 ? first : second)

    expect(await manager.open({ backend: 'dexie', projectId: 1 })).toBe(first)
    expect(await manager.open({ backend: 'dexie', projectId: 1 })).toBe(first)
    expect(closeFirst).not.toHaveBeenCalled()
    expect(await manager.open({ backend: 'dexie', projectId: 2 })).toBe(second)
    expect(closeFirst).toHaveBeenCalledOnce()
    expect(manager.requireActive({ backend: 'dexie', projectId: 2 })).toBe(second)
  })

  it('rejects unregistered backends and locator mismatches', async () => {
    const manager = new ProjectStorageManager()
    await expect(manager.open({
      backend: 'local-folder', projectUuid: 'uuid', projectPath: 'F:/novels/demo',
    })).rejects.toThrow('not registered')
    expect(() => manager.requireActive()).toThrow('no active')

    manager.register('dexie', async locator => new MemoryProjectStorage(locator))
    await manager.open({ backend: 'dexie', projectId: 1 })
    expect(() => manager.requireActive({ backend: 'dexie', projectId: 2 })).toThrow('locator mismatch')
  })
})
