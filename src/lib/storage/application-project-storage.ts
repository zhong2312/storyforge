import { DexieProjectStorage } from './adapters/dexie'
import { projectLocatorKey, type ProjectStoragePort } from './ports'
import { db } from '../db/schema'

let activeProjectId: number | null = null
let activeStorage: ProjectStoragePort | null = null
const dexieStorages = new Map<number, DexieProjectStorage>()

export function activateProjectStorage(projectId: number, storage?: ProjectStoragePort): ProjectStoragePort {
  const next = storage ?? getDexieProjectStorage(projectId)
  activeProjectId = projectId
  activeStorage = next
  return next
}

export function deactivateProjectStorage(projectId?: number): void {
  if (projectId !== undefined && activeProjectId !== projectId) return
  activeProjectId = null
  activeStorage = null
}

export function getActiveProjectStorage(projectId?: number): ProjectStoragePort | undefined {
  if (!activeStorage) return undefined
  if (projectId !== undefined && activeProjectId !== projectId) return undefined
  return activeStorage
}

export function requireActiveProjectStorage(projectId?: number): ProjectStoragePort {
  const storage = getActiveProjectStorage(projectId)
  if (!storage) throw new Error('[application-storage] no matching active project storage')
  return storage
}

export function getDexieProjectStorage(projectId: number): DexieProjectStorage {
  let storage = dexieStorages.get(projectId)
  if (!storage) {
    storage = new DexieProjectStorage({ backend: 'dexie', projectId })
    dexieStorages.set(projectId, storage)
  }
  return storage
}

export function isActiveStorage(storage: ProjectStoragePort): boolean {
  return activeStorage != null
    && projectLocatorKey(activeStorage.locator) === projectLocatorKey(storage.locator)
}

/** Dexie 的 projects 行只作为首页项目索引；本地项目正文和设定不会双写。 */
export async function syncDexieProjectIndex(projectId: number, patch: Record<string, unknown>): Promise<void> {
  if (getActiveProjectStorage(projectId)?.locator.backend !== 'local-folder') return
  if (await db.projects.get(projectId)) await db.projects.update(projectId, patch as any)
}
