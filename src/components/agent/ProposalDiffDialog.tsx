import { useMemo, useState } from 'react'
import { FileText, GitCompareArrows, Rows3, X } from 'lucide-react'
import ReactDiffViewer, { DiffMethod, type ReactDiffViewerStylesOverride } from 'react-diff-viewer-continued'
import type { AgentChangePreview } from '../../lib/agent/events/agent-events'
import { createProposalDiff } from '../../lib/agent/presentation/proposal-diff'

interface ProposalDiffDialogProps {
  preview: AgentChangePreview
  onClose: () => void
}

const DIFF_STYLES: ReactDiffViewerStylesOverride = {
  variables: {
    light: {
      diffViewerBackground: 'var(--bg-elevated)',
      diffViewerTitleBackground: 'var(--bg-surface)',
      diffViewerColor: 'var(--text-primary)',
      diffViewerTitleColor: 'var(--text-primary)',
      diffViewerTitleBorderColor: 'var(--border)',
      addedBackground: 'color-mix(in srgb, #16a34a 18%, var(--bg-elevated))',
      addedColor: 'var(--text-primary)',
      removedBackground: 'color-mix(in srgb, #dc2626 18%, var(--bg-elevated))',
      removedColor: 'var(--text-primary)',
      wordAddedBackground: 'color-mix(in srgb, #16a34a 48%, var(--bg-elevated))',
      wordRemovedBackground: 'color-mix(in srgb, #dc2626 45%, var(--bg-elevated))',
      addedGutterBackground: 'color-mix(in srgb, #16a34a 30%, var(--bg-surface))',
      removedGutterBackground: 'color-mix(in srgb, #dc2626 30%, var(--bg-surface))',
      gutterBackground: 'var(--bg-surface)',
      gutterBackgroundDark: 'var(--bg-base)',
      codeFoldGutterBackground: 'var(--bg-surface)',
      codeFoldBackground: 'var(--bg-surface)',
      emptyLineBackground: 'var(--bg-base)',
      gutterColor: 'var(--text-muted)',
      addedGutterColor: 'var(--text-primary)',
      removedGutterColor: 'var(--text-primary)',
      codeFoldContentColor: 'var(--text-secondary)',
    },
  },
  diffContainer: {
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    fontSize: '13px',
    minWidth: '100%',
  },
  contentText: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: '1.75',
  },
  line: { verticalAlign: 'top' },
  lineNumber: { minWidth: '3rem' },
  marker: { padding: '0 6px' },
  codeFold: { fontSize: '12px' },
}

export function ProposalDiffDialog({ preview, onClose }: ProposalDiffDialogProps) {
  const diff = useMemo(() => createProposalDiff(preview), [preview])
  const [showDiffOnly, setShowDiffOnly] = useState(true)
  const stats = useMemo(() => diff.changes.reduce((total, change) => {
    const count = change.value.replace(/\s/g, '').length
    if (change.added) total.added += count
    if (change.removed) total.removed += count
    return total
  }, { added: 0, removed: 0 }), [diff.changes])

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-label="变更差异对比">
      <div className="flex h-[min(860px,94vh)] w-full max-w-7xl flex-col overflow-hidden rounded-lg border border-border bg-bg-surface shadow-2xl">
        <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <GitCompareArrows className="h-5 w-5 text-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-text-primary">变更差异对比</h2>
            <div className="mt-1 flex items-center gap-3 text-xs text-text-muted" aria-label="差异颜色图例">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 border border-red-500 bg-red-300" />红色为删除</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 border border-emerald-600 bg-emerald-300" />绿色为新增</span>
              {diff.changed && <span className="font-medium text-text-secondary">+{stats.added} 字 / -{stats.removed} 字</span>}
            </div>
          </div>
          {diff.changed && (
            <div className="flex rounded-md border border-border bg-bg-base p-0.5" role="group" aria-label="对比显示范围">
              <button
                type="button"
                onClick={() => setShowDiffOnly(true)}
                className={`flex items-center gap-1 rounded px-2.5 py-1.5 text-xs ${showDiffOnly ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'}`}
              >
                <Rows3 className="h-3.5 w-3.5" />仅看差异
              </button>
              <button
                type="button"
                onClick={() => setShowDiffOnly(false)}
                className={`flex items-center gap-1 rounded px-2.5 py-1.5 text-xs ${!showDiffOnly ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'}`}
              >
                <FileText className="h-3.5 w-3.5" />完整全文
              </button>
            </div>
          )}
          <button type="button" onClick={onClose} className="rounded p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary" aria-label="关闭差异对比">
            <X className="h-4 w-4" />
          </button>
        </header>

        {diff.changed ? (
          <div className="min-h-0 flex-1 overflow-auto bg-bg-elevated" data-testid="proposal-diff-viewer">
            <ReactDiffViewer
              oldValue={diff.beforeText}
              newValue={diff.afterText}
              splitView
              compareMethod={DiffMethod.WORDS_WITH_SPACE}
              showDiffOnly={showDiffOnly}
              extraLinesSurroundingDiff={3}
              leftTitle="修改前"
              rightTitle="修改后"
              styles={DIFF_STYLES}
              codeFoldMessageRenderer={total => <span>展开中间 {total} 行未修改内容</span>}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <div className="max-w-md rounded-lg border border-amber-500/40 bg-amber-500/10 px-6 py-5">
              <p className="text-sm font-semibold text-text-primary">候选内容与当前内容完全一致</p>
              <p className="mt-2 text-xs leading-5 text-text-secondary">本次方案没有产生任何可采纳的正文修改，因此没有新增或删除内容可供对比。</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
