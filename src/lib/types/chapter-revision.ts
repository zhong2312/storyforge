export type ChapterRevisionSource = 'edit' | 'agent' | 'restore' | 'manual'

/** 章节正文的本地版本记录。正文仍以 chapters.content 为唯一当前版本。 */
export interface ChapterRevision {
  id?: number
  projectId: number
  chapterId: number
  content: string
  wordCount: number
  source: ChapterRevisionSource
  label?: string
  createdAt: number
}
