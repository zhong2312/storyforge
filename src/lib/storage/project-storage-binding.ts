import { BrowserDirectoryFileSystem, LocalFolderProjectStorage } from './adapters/local-folder'
import { ensureFolderPermission, folderPermissionGranted } from './folder-backup'
import { clearFolderHandle, loadFolderHandle, saveFolderHandle } from './folder-handle-store'
import { activateProjectStorage, getDexieProjectStorage } from './application-project-storage'
import { migrateProjectStorage, type StorageMigrationReport } from './storage-migration'

const BINDING_KEY = 'storyforge.project-storage.bindings.v1'
const handleKey = (projectId: number) => `active-storage-${projectId}`

export interface LocalFolderStorageBinding {
  backend: 'local-folder'
  projectId: number
  projectUuid: string
  folderName: string
}

export class ProjectStoragePermissionError extends Error {
  constructor(readonly projectId: number) {
    super('本地项目文件夹需要重新授权')
    this.name = 'ProjectStoragePermissionError'
  }
}

export function loadProjectStorageBinding(projectId: number): LocalFolderStorageBinding | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const all = JSON.parse(localStorage.getItem(BINDING_KEY) || '{}') as Record<string, LocalFolderStorageBinding>
    return all[String(projectId)] ?? null
  } catch {
    return null
  }
}

export async function openBoundProjectStorage(
  projectId: number,
  requestPermission = false,
): Promise<LocalFolderProjectStorage | null> {
  const binding = loadProjectStorageBinding(projectId)
  if (!binding) return null
  const handle = await loadFolderHandle(handleKey(projectId))
  if (!handle) throw new Error('本地项目文件夹句柄已丢失，请重新绑定')
  const granted = requestPermission
    ? await ensureFolderPermission(handle)
    : await folderPermissionGranted(handle)
  if (!granted) throw new ProjectStoragePermissionError(projectId)
  const storage = new LocalFolderProjectStorage({
    backend: 'local-folder',
    projectUuid: binding.projectUuid,
    projectPath: handle.name,
  }, new BrowserDirectoryFileSystem(handle))
  const project = await storage.table('projects').get(projectId)
  if (!project) throw new Error('本地项目文件与当前项目不匹配')
  activateProjectStorage(projectId, storage)
  return storage
}

export async function migrateDexieProjectToFolder(
  projectId: number,
  handle: FileSystemDirectoryHandle,
): Promise<StorageMigrationReport> {
  if (!await ensureFolderPermission(handle)) throw new ProjectStoragePermissionError(projectId)
  const binding: LocalFolderStorageBinding = {
    backend: 'local-folder',
    projectId,
    projectUuid: crypto.randomUUID(),
    folderName: handle.name,
  }
  const target = new LocalFolderProjectStorage({
    backend: 'local-folder',
    projectUuid: binding.projectUuid,
    projectPath: handle.name,
  }, new BrowserDirectoryFileSystem(handle))
  try {
    const report = await migrateProjectStorage(getDexieProjectStorage(projectId), target)
    await saveFolderHandle(handleKey(projectId), handle)
    saveBinding(binding)
    activateProjectStorage(projectId, target)
    return report
  } catch (error) {
    await target.close().catch(() => {})
    throw error
  }
}

export async function removeProjectStorageBinding(projectId: number): Promise<void> {
  if (typeof localStorage !== 'undefined') {
    const all = readBindings()
    delete all[String(projectId)]
    localStorage.setItem(BINDING_KEY, JSON.stringify(all))
  }
  await clearFolderHandle(handleKey(projectId))
}

function saveBinding(binding: LocalFolderStorageBinding): void {
  const all = readBindings()
  all[String(binding.projectId)] = binding
  localStorage.setItem(BINDING_KEY, JSON.stringify(all))
}

function readBindings(): Record<string, LocalFolderStorageBinding> {
  try { return JSON.parse(localStorage.getItem(BINDING_KEY) || '{}') as Record<string, LocalFolderStorageBinding> }
  catch { return {} }
}
