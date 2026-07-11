import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  projectLocatorKey,
  sameProjectLocator,
  type ProjectLocator,
} from '../../src/lib/storage/ports/project-locator'

describe('project locator', () => {
  it('uses readonly fields for every backend locator variant', () => {
    expectTypeOf<ProjectLocator>().toEqualTypeOf<
      | { readonly backend: 'dexie'; readonly projectId: number }
      | { readonly backend: 'local-folder'; readonly projectUuid: string; readonly projectPath: string }
    >()
  })

  it('为 Dexie 项目生成由后端与 projectId 组成的 key', () => {
    expect(projectLocatorKey({ backend: 'dexie', projectId: 12 })).toBe('dexie:12')
  })

  it('为本地目录项目生成由后端与 projectUuid 组成的 key', () => {
    expect(projectLocatorKey({
      backend: 'local-folder',
      projectUuid: 'book-uuid',
      projectPath: 'F:/books/demo',
    })).toBe('local-folder:book-uuid')
  })

  it('将 projectPath 不同但 projectUuid 相同的本地目录视为同一逻辑项目', () => {
    const left: ProjectLocator = {
      backend: 'local-folder',
      projectUuid: 'book-uuid',
      projectPath: 'F:/books/demo',
    }
    const right: ProjectLocator = {
      backend: 'local-folder',
      projectUuid: 'book-uuid',
      projectPath: 'G:/archive/demo',
    }

    expect(sameProjectLocator(left, right)).toBe(true)
  })

  it('不会将 projectId 不同的 Dexie 定位器视为同一项目', () => {
    const first: ProjectLocator = { backend: 'dexie', projectId: 1 }
    const second: ProjectLocator = { backend: 'dexie', projectId: 2 }

    expect(sameProjectLocator(first, second)).toBe(false)
  })

  it('本地目录使用 projectUuid 而不是 projectPath 区分逻辑项目', () => {
    const first: ProjectLocator = {
      backend: 'local-folder',
      projectUuid: 'project-a',
      projectPath: 'F:/books/shared-path',
    }
    const second: ProjectLocator = {
      backend: 'local-folder',
      projectUuid: 'project-b',
      projectPath: 'F:/books/shared-path',
    }

    expect(sameProjectLocator(first, second)).toBe(false)
  })

  it('不会将 local-folder 与 dexie 定位器视为同一项目', () => {
    const localFolder: ProjectLocator = {
      backend: 'local-folder',
      projectUuid: '12',
      projectPath: 'F:/books/demo',
    }
    const dexie: ProjectLocator = { backend: 'dexie', projectId: 12 }

    expect(sameProjectLocator(localFolder, dexie)).toBe(false)
  })
})
