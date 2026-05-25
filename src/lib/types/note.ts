/**
 * 便签/笔记 — Phase H3
 */

export interface Note {
  id?: number
  projectId: number
  /** 关联章节 ID（可选） */
  chapterId?: number
  /** 笔记内容 */
  content: string
  /** 便签颜色 */
  color: NoteColor
  /** 是否置顶 */
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export type NoteColor = 'yellow' | 'blue' | 'green' | 'pink' | 'purple' | 'orange'

export const NOTE_COLORS: Record<NoteColor, { bg: string; text: string; label: string }> = {
  yellow: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-800 dark:text-yellow-200', label: '黄色' },
  blue:   { bg: 'bg-blue-100 dark:bg-blue-900/30',     text: 'text-blue-800 dark:text-blue-200',     label: '蓝色' },
  green:  { bg: 'bg-green-100 dark:bg-green-900/30',   text: 'text-green-800 dark:text-green-200',   label: '绿色' },
  pink:   { bg: 'bg-pink-100 dark:bg-pink-900/30',     text: 'text-pink-800 dark:text-pink-200',     label: '粉色' },
  purple: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-800 dark:text-purple-200', label: '紫色' },
  orange: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-800 dark:text-orange-200', label: '橙色' },
}
