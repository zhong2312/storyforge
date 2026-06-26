/**
 * 正文写作面板
 *
 * 目标：正文页是沉浸写作界面，不再嵌套第二层章节侧栏。
 * 章节切换收进顶部轻量控件，主区域交给 ChapterEditor 呈现“路径 / 工具条 / 目标条 / 稿纸”。
 */
import { useState, useEffect, useMemo } from 'react'
import { useOutlineStore } from '../../stores/outline'
import { useChapterStore } from '../../stores/chapter'
import ChapterEditor from './ChapterEditor'
import type { Project } from '../../lib/types'

interface Props {
  project: Project
  /** 外部指定要打开的 outlineNodeId（从大纲跳转过来） */
  initialNodeId?: number | null
}

export default function ChaptersListPanel({ project, initialNodeId }: Props) {
  const { nodes, loadAll: loadOutline } = useOutlineStore()
  const { chapters, loadAll: loadChapters } = useChapterStore()
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(initialNodeId ?? null)

  useEffect(() => {
    loadOutline(project.id!)
    loadChapters(project.id!)
  }, [project.id, loadOutline, loadChapters])

  useEffect(() => {
    if (initialNodeId != null) setSelectedNodeId(initialNodeId)
  }, [initialNodeId])

  const volumeGroups = useMemo(() => {
    const volumes = nodes.filter(n => n.type === 'volume' && n.parentId === null).sort((a, b) => a.order - b.order)
    return volumes.map(vol => ({
      volume: vol,
      chapters: nodes
        .filter(n => n.parentId === vol.id && n.type === 'chapter')
        .sort((a, b) => a.order - b.order),
    }))
  }, [nodes])

  const flattenedChapters = useMemo(
    () => volumeGroups.flatMap(group => group.chapters.map(chapter => ({ chapter, volume: group.volume }))),
    [volumeGroups],
  )

  useEffect(() => {
    if (selectedNodeId != null) return
    const first = flattenedChapters[0]?.chapter
    if (first?.id != null) setSelectedNodeId(first.id)
  }, [flattenedChapters, selectedNodeId])

  const selectedNode = nodes.find(n => n.id === selectedNodeId)
  const totalChapters = flattenedChapters.length
  const totalWords = chapters.reduce((sum, chapter) => sum + (chapter.wordCount || 0), 0)

  if (!selectedNode) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg-base/30 text-text-muted">
        <div className="text-4xl opacity-20">📝</div>
        <p className="text-sm">
          {totalChapters > 0
            ? '选择一个章节开始写作'
            : '先在「大纲」里生成章节，然后回来写作'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-base/30">
      <div className="flex items-center justify-between gap-4 border-b border-border bg-bg-base/90 px-6 py-2.5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-[11px] uppercase tracking-[0.18em] text-text-muted">章节</span>
          <select
            value={selectedNodeId ?? ''}
            onChange={event => setSelectedNodeId(Number(event.target.value))}
            aria-label="切换正文章节"
            className="max-w-[420px] rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            {volumeGroups.map(group => (
              <optgroup key={group.volume.id} label={group.volume.title}>
                {group.chapters.map((chapter, index) => (
                  <option key={chapter.id} value={chapter.id}>
                    {index + 1}. {chapter.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="shrink-0 text-xs text-text-muted">
          共 {totalChapters} 章 · {totalWords.toLocaleString()} 字
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ChapterEditor key={selectedNode.id} project={project} outlineNodeId={selectedNode.id!} />
      </div>
    </div>
  )
}
