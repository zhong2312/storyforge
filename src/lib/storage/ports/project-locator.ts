export type ProjectLocator =
  | { readonly backend: 'dexie'; readonly projectId: number }
  | { readonly backend: 'local-folder'; readonly projectUuid: string; readonly projectPath: string }

export function projectLocatorKey(locator: ProjectLocator): string {
  if (locator.backend === 'dexie') {
    return `dexie:${locator.projectId}`
  }

  return `local-folder:${locator.projectUuid}`
}

export function sameProjectLocator(left: ProjectLocator, right: ProjectLocator): boolean {
  return projectLocatorKey(left) === projectLocatorKey(right)
}
