import type { Table } from 'dexie'
import type { StorageTable } from '../storage/ports'
import type { Chapter, ChapterRevision, ChapterRevisionSource } from '../types'

export const MAX_CHAPTER_REVISIONS = 100
export const EDIT_REVISION_WINDOW_MS = 5 * 60 * 1000

export interface RevisionHistoryWriter {
  listByChapter(chapterId: number): Promise<ChapterRevision[]>
  add(revision: ChapterRevision): Promise<number>
  bulkDelete(ids: number[]): Promise<void>
}

export function dexieRevisionWriter(table: Table<ChapterRevision, number>): RevisionHistoryWriter {
  return {
    listByChapter: async chapterId => {
      const revisions = await table.where('chapterId').equals(chapterId).toArray()
      return revisions.sort((left, right) => (
        right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0)
      ))
    },
    add: revision => table.add(revision),
    bulkDelete: ids => table.bulkDelete(ids),
  }
}

export function storageRevisionWriter(table: StorageTable<ChapterRevision>): RevisionHistoryWriter {
  return {
    listByChapter: async chapterId => {
      const revisions = await table.list({ where: { chapterId } })
      return revisions.sort((left, right) => (
        right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0)
      ))
    },
    add: revision => table.add(revision),
    bulkDelete: ids => table.bulkDelete(ids),
  }
}

interface RecordRevisionOptions {
  source: ChapterRevisionSource
  label?: string
  now?: number
  coalesceEdits?: boolean
}

/** 在已开启的写事务中保存旧正文，并按章限制历史数量。 */
export async function recordChapterRevision(
  table: RevisionHistoryWriter,
  chapter: Chapter,
  nextContent: string,
  options: RecordRevisionOptions,
): Promise<boolean> {
  if (chapter.id == null || chapter.content === nextContent) return false

  const createdAt = options.now ?? Date.now()
  const revisions = await table.listByChapter(chapter.id)
  const latest = revisions[0]
  if (latest?.content === chapter.content) return false
  if (
    options.coalesceEdits
    && latest?.source === 'edit'
    && createdAt - latest.createdAt < EDIT_REVISION_WINDOW_MS
  ) return false

  await table.add({
    projectId: chapter.projectId,
    chapterId: chapter.id,
    content: chapter.content,
    wordCount: chapter.wordCount,
    source: options.source,
    label: options.label,
    createdAt,
  })

  const overflow = revisions.slice(MAX_CHAPTER_REVISIONS - 1)
    .map(revision => revision.id)
    .filter((id): id is number => id != null)
  if (overflow.length) await table.bulkDelete(overflow)
  return true
}
