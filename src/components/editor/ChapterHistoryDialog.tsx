import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock3, History, RotateCcw, X } from 'lucide-react'
import { db } from '../../lib/db/schema'
import type { ChapterRevision, ChapterRevisionSource } from '../../lib/types'
import { htmlToPlainText } from '../../lib/utils/html'
import { useChapterStore } from '../../stores/chapter'
import { useDialog } from '../shared/Dialog'
import { useToast } from '../shared/Toast'

interface ChapterHistoryDialogProps {
  chapterId: number
  chapterTitle: string
  onClose: () => void
}

const SOURCE_LABELS: Record<ChapterRevisionSource, string> = {
  edit: '编辑保存',
  agent: 'AI 采纳前',
  restore: '恢复前',
  manual: '手动保存',
}

export function ChapterHistoryDialog({ chapterId, chapterTitle, onClose }: ChapterHistoryDialogProps) {
  const [revisions, setRevisions] = useState<ChapterRevision[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState(false)
  const restoreChapterRevision = useChapterStore(state => state.restoreChapterRevision)
  const dialog = useDialog()
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    const rows = await db.chapterRevisions.where('chapterId').equals(chapterId).toArray()
    rows.sort((left, right) => (
      right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0)
    ))
    setRevisions(rows)
    setSelectedId(current => rows.some(row => row.id === current) ? current : (rows[0]?.id ?? null))
    setLoading(false)
  }, [chapterId])

  useEffect(() => { void load() }, [load])

  const selected = useMemo(
    () => revisions.find(revision => revision.id === selectedId) ?? null,
    [revisions, selectedId],
  )

  const handleRestore = async () => {
    if (!selected?.id || restoring) return
    const confirmed = await dialog.confirm({
      title: '恢复此正文版本？',
      message: '当前正文会先自动保存到历史记录，恢复后仍可切换回来。',
      confirmText: '恢复版本',
    })
    if (!confirmed) return
    setRestoring(true)
    try {
      const restored = await restoreChapterRevision(selected.id)
      if (!restored) throw new Error('历史版本或章节不存在')
      await load()
      toast.toast('success', '已恢复正文历史版本')
    } catch (error) {
      toast.toast('error', error instanceof Error ? error.message : '恢复失败')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="正文历史">
      <div className="flex h-[min(760px,90vh)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-bg-surface shadow-2xl">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <History className="h-5 w-5 text-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-text-primary">正文历史</h2>
            <p className="truncate text-xs text-text-muted">{chapterTitle}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary" aria-label="关闭正文历史">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="max-h-56 overflow-y-auto border-b border-border bg-bg-base/40 p-3 md:max-h-none md:border-b-0 md:border-r">
            {loading && <p className="px-2 py-6 text-center text-xs text-text-muted">正在读取历史...</p>}
            {!loading && revisions.length === 0 && (
              <div className="px-3 py-10 text-center">
                <History className="mx-auto h-7 w-7 text-text-muted/50" />
                <p className="mt-2 text-xs text-text-muted">修改并保存正文后，旧版本会显示在这里。</p>
              </div>
            )}
            <div className="space-y-1.5">
              {revisions.map(revision => (
                <button
                  type="button"
                  key={revision.id}
                  onClick={() => setSelectedId(revision.id ?? null)}
                  className={`w-full rounded-md border px-3 py-2.5 text-left transition-colors ${
                    revision.id === selectedId
                      ? 'border-accent/50 bg-accent/10'
                      : 'border-transparent hover:border-border hover:bg-bg-hover'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
                    <Clock3 className="h-3.5 w-3.5 text-text-muted" />
                    {new Date(revision.createdAt).toLocaleString('zh-CN')}
                  </span>
                  <span className="mt-1 block text-[11px] text-text-muted">
                    {revision.label || SOURCE_LABELS[revision.source]} · {revision.wordCount.toLocaleString()} 字
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <main className="flex min-w-0 flex-col">
            {selected ? (
              <>
                <div className="flex items-center justify-between border-b border-border px-5 py-3">
                  <div>
                    <p className="text-xs font-medium text-text-primary">{new Date(selected.createdAt).toLocaleString('zh-CN')}</p>
                    <p className="mt-0.5 text-[11px] text-text-muted">{SOURCE_LABELS[selected.source]} · {selected.wordCount.toLocaleString()} 字</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { void handleRestore() }}
                    disabled={restoring}
                    className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {restoring ? '恢复中...' : '恢复此版本'}
                  </button>
                </div>
                <article className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-8 py-6 font-serif text-sm leading-8 text-text-secondary">
                  {htmlToPlainText(selected.content) || '（空白正文）'}
                </article>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-text-muted">选择一个历史版本查看正文</div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
