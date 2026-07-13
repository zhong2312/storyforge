import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react'
import { projectInitializationProgress, useProjectInitializationStore } from '../../stores/project-initialization'

export default function ProjectInitializationProgressIndicator({
  projectId,
  onOpen,
}: {
  projectId: number
  onOpen: () => void
}) {
  const task = useProjectInitializationStore(state => state.task)
  if (!task || task.projectId !== projectId || task.status === 'idle') return null
  const progress = projectInitializationProgress(task)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="fixed bottom-5 left-1/2 z-40 flex min-w-64 -translate-x-1/2 items-center gap-3 rounded-md border border-border bg-bg-elevated px-3 py-2.5 text-left shadow-xl hover:border-accent/40"
    >
      {task.status === 'running'
        ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-accent" />
        : task.status === 'completed'
          ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          : <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-text-primary">{task.currentStepLabel || statusLabel(task.status)}</span>
        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-border">
          <span className="block h-full bg-accent transition-[width]" style={{ width: `${progress.percent}%` }} />
        </span>
      </span>
      <span className="shrink-0 text-xs font-semibold text-accent">{progress.percent}%</span>
    </button>
  )
}

function statusLabel(status: string): string {
  if (status === 'completed') return '项目初始化完成'
  if (status === 'failed') return '项目初始化失败'
  if (status === 'cancelled') return '项目初始化已停止'
  return '等待开始'
}
