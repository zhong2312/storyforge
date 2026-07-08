import { describe, expect, it } from 'vitest'
import { resolveChapterDisplayMeta } from '../../src/lib/outline/chapter-display'
import type { Chapter, OutlineNode } from '../../src/lib/types'

const now = Date.now()

function outline(id: number, parentId: number | null, order: number, title: string, type: OutlineNode['type'] = 'chapter'): OutlineNode {
  return {
    id, projectId: 1, parentId, type, title, summary: '', order,
    createdAt: now, updatedAt: now,
  }
}

function chapter(id: number, outlineNodeId: number, order: number, title: string): Chapter {
  return {
    id, projectId: 1, outlineNodeId, title, content: '', wordCount: 0,
    status: 'draft', order, notes: '', createdAt: now, updatedAt: now,
  }
}

describe('R-CF20260708-chapter-display-title: 正文页标题从大纲派生', () => {
  it('uses outline title and canonical outline order even when Chapter.title/order is stale', () => {
    const volume = outline(1, null, 0, '第一卷', 'volume')
    const firstNode = outline(2, 1, 0, '第一章 新章名')
    const secondNode = outline(3, 1, 1, '第二章 发射与抵达')
    const secondChapter = chapter(11, 3, 5, '第四十一章 发射与抵达')

    expect(resolveChapterDisplayMeta(secondChapter, [volume, firstNode, secondNode], [secondChapter]))
      .toEqual({
        title: '第二章 发射与抵达',
        ordinal: 2,
      })
  })

  it('reindexes the surviving chapter after middle outline chapters are deleted', () => {
    const volume = outline(1, null, 0, '第一卷', 'volume')
    const firstNode = outline(2, 1, 0, '第一章')
    const originalSixthNode = outline(7, 1, 5, '第六章 删除后应变第二章')
    const originalSixthChapter = chapter(16, 7, 5, '第六章 删除后应变第二章')

    expect(resolveChapterDisplayMeta(
      originalSixthChapter,
      [volume, firstNode, originalSixthNode],
      [originalSixthChapter],
    )).toEqual({
      title: '第六章 删除后应变第二章',
      ordinal: 2,
    })
  })
})
