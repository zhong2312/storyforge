import { GitCompareArrows, Minus, Plus, X } from 'lucide-react'
import type { Change } from 'diff'
import type { AgentChangePreview } from '../../lib/agent/events/agent-events'
import { createProposalDiff } from '../../lib/agent/presentation/proposal-diff'

interface ProposalDiffDialogProps {
  preview: AgentChangePreview
  onClose: () => void
}

export function ProposalDiffDialog({ preview, onClose }: ProposalDiffDialogProps) {
  const diff = createProposalDiff(preview)
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-label="变更差异对比">
      <div className="flex h-[min(820px,92vh)] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-bg-surface shadow-2xl">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <GitCompareArrows className="h-5 w-5 text-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-text-primary">变更差异对比</h2>
            <div className="mt-1 flex items-center gap-3 text-xs text-text-muted" aria-label="差异颜色图例">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 border border-red-400 bg-red-200 dark:bg-red-900" />红色为删除</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 border border-emerald-500 bg-emerald-200 dark:bg-emerald-900" />绿色为新增</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary" aria-label="关闭差异对比">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
          <DiffPane title="修改前" icon={<Minus className="h-3.5 w-3.5" />} changes={diff.changes} side="before" />
          <DiffPane title="修改后" icon={<Plus className="h-3.5 w-3.5" />} changes={diff.changes} side="after" />
        </div>
      </div>
    </div>
  )
}

function DiffPane({
  title,
  icon,
  changes,
  side,
}: {
  title: string
  icon: React.ReactNode
  changes: readonly Change[]
  side: 'before' | 'after'
}) {
  return (
    <section className={`flex min-h-0 flex-col ${side === 'before' ? 'border-b border-border md:border-b-0 md:border-r' : ''}`}>
      <div className="flex items-center gap-1.5 border-b border-border bg-bg-base/40 px-4 py-2 text-xs font-medium text-text-secondary">
        {icon}{title}
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-xs leading-6 text-text-secondary">
        {changes.map((change, index) => {
          if (side === 'before' && change.added) return null
          if (side === 'after' && change.removed) return null
          const changed = side === 'before' ? change.removed : change.added
          return (
            <span
              key={`${index}:${change.value.length}`}
              className={changed
                ? side === 'before'
                  ? 'border-l-2 border-red-500 bg-red-100 text-red-900 dark:bg-red-950/70 dark:text-red-100'
                  : 'border-l-2 border-emerald-500 bg-emerald-100 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-100'
                : undefined}
            >
              {change.value}
            </span>
          )
        })}
      </pre>
    </section>
  )
}
