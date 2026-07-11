import { projectLocatorKey, type ProjectLocator, type ProjectStoragePort } from './ports'
import { migrateProjectStorage, type StorageMigrationOptions, type StorageMigrationReport } from './storage-migration'

export type ProjectStorageOpener = (locator: ProjectLocator) => Promise<ProjectStoragePort>

export class ProjectStorageManager {
  readonly #openers = new Map<ProjectLocator['backend'], ProjectStorageOpener>()
  #active?: ProjectStoragePort

  register(backend: ProjectLocator['backend'], opener: ProjectStorageOpener): void {
    this.#openers.set(backend, opener)
  }

  get active(): ProjectStoragePort | undefined {
    return this.#active
  }

  async open(locator: ProjectLocator): Promise<ProjectStoragePort> {
    if (this.#active && projectLocatorKey(this.#active.locator) === projectLocatorKey(locator)) {
      return this.#active
    }
    const opener = this.#openers.get(locator.backend)
    if (!opener) throw new Error(`[storage-manager] backend is not registered: ${locator.backend}`)
    const next = await opener(locator)
    const previous = this.#active
    this.#active = next
    if (previous) await previous.close()
    return next
  }

  requireActive(locator?: ProjectLocator): ProjectStoragePort {
    if (!this.#active) throw new Error('[storage-manager] no active project storage')
    if (locator && projectLocatorKey(this.#active.locator) !== projectLocatorKey(locator)) {
      throw new Error('[storage-manager] active project locator mismatch')
    }
    return this.#active
  }

  async migrate(
    sourceLocator: ProjectLocator,
    targetLocator: ProjectLocator,
    options?: StorageMigrationOptions,
  ): Promise<StorageMigrationReport> {
    const sourceOpener = this.#openers.get(sourceLocator.backend)
    const targetOpener = this.#openers.get(targetLocator.backend)
    if (!sourceOpener || !targetOpener) throw new Error('[storage-manager] migration backend is not registered')
    const activeKey = this.#active ? projectLocatorKey(this.#active.locator) : undefined
    const source = activeKey === projectLocatorKey(sourceLocator)
      ? this.#active!
      : await sourceOpener(sourceLocator)
    const target = await targetOpener(targetLocator)
    try {
      return await migrateProjectStorage(source, target, options)
    } finally {
      await target.close()
      if (source !== this.#active) await source.close()
    }
  }

  async close(): Promise<void> {
    const active = this.#active
    this.#active = undefined
    if (active) await active.close()
  }
}
