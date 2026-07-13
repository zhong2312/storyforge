import { useMemo, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Circle,
  LoaderCircle,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import type { Project } from '../../lib/types'
import {
  createProjectInitializationPlan,
  type InitializationGroupId,
  type ProjectInitializationItem,
} from '../../services/project-initialization-runner'
import {
  projectInitializationProgress,
  useProjectInitializationStore,
} from '../../stores/project-initialization'

interface DialogProps {
  project: Project
  worldGroupId: number | null
  onClose: () => void
  onCommit: () => void | Promise<void>
}

const GROUPS: Array<{ id: InitializationGroupId; label: string; description: string }> = [
  { id: 'worldview', label: '世界观', description: '真实与幻想、起源、自然、人文、历史和地图' },
  { id: 'story', label: '故事设计', description: '故事概念、主题、冲突、主线与复线' },
  { id: 'characters', label: '角色设计', description: '核心人物、重要配角和功能角色' },
]

export default function ProjectInitializationDialog({
  project,
  worldGroupId,
  onClose,
  onCommit,
}: DialogProps) {
  const task = useProjectInitializationStore(state => state.task)
  const start = useProjectInitializationStore(state => state.start)
  const resume = useProjectInitializationStore(state => state.resume)
  const cancel = useProjectInitializationStore(state => state.cancel)
  const currentTask = task?.projectId === project.id ? task : null
  const anotherTaskRunning = task?.status === 'running' && task.projectId !== project.id
  const [idea, setIdea] = useState(currentTask?.idea || project.description || '')
  const [characterCount, setCharacterCount] = useState(currentTask?.characterCount || 12)
  const [confirmReinitialize, setConfirmReinitialize] = useState(false)
  const preview = useMemo(() => createProjectInitializationPlan({
    project,
    idea: idea.trim(),
    characterCount,
    worldGroupId,
  }), [characterCount, idea, project, worldGroupId])
  const items = currentTask?.items ?? preview.items
  const progress = projectInitializationProgress(currentTask)
  const running = currentTask?.status === 'running'

  const handleStart = () => {
    if (!idea.trim() || running || anotherTaskRunning) return
    start({ project, idea: idea.trim(), characterCount, worldGroupId, onCommit })
  }

  const handleResume = () => {
    if (!currentTask || running || anotherTaskRunning) return
    resume({ project, onCommit })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-label="AI 初始化项目">
      <section className="flex h-[min(880px,92vh)] w-[min(980px,96vw)] flex-col overflow-hidden rounded-lg border border-border bg-bg-surface shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
              <Sparkles className="h-5 w-5 text-accent" />
              AI 全自动初始化
            </h2>
            <p className="mt-1 text-xs text-text-muted">关闭窗口或切换菜单不会中断任务；每完成一个批次，项目页面会立即更新。</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary" aria-label="关闭初始化窗口">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-b border-border/70 px-5 py-5">
            <label className="mb-2 block text-sm font-medium text-text-primary" htmlFor="project-initialization-idea">故事大概思路</label>
            <textarea
              id="project-initialization-idea"
              value={running ? currentTask.idea : idea}
              onChange={event => setIdea(event.target.value)}
              disabled={running}
              rows={7}
              placeholder="例如：一个被宗门逐出的少年发现，所谓飞升其实是上界收割下界灵魂的骗局。他要联合不同立场的人，打破延续万年的秩序……"
              className="w-full resize-y rounded-md border border-border bg-bg-base px-3 py-2.5 text-sm leading-6 text-text-primary focus:border-accent focus:outline-none disabled:opacity-70"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                初始化角色数量
                <input
                  type="number"
                  min={10}
                  max={30}
                  value={running ? currentTask.characterCount : characterCount}
                  disabled={running}
                  onChange={event => setCharacterCount(Math.max(10, Math.min(30, Number(event.target.value) || 10)))}
                  className="w-16 rounded border border-border bg-bg-base px-2 py-1 text-center text-text-primary focus:border-accent focus:outline-none"
                />
                <span className="text-text-muted">10-30</span>
              </label>
              <p className="text-xs text-text-muted">启动后将按下方清单自动生成、自动采纳并逐项写入当前项目。</p>
            </div>
          </div>

          {(running || currentTask?.status === 'completed' || currentTask?.status === 'failed' || currentTask?.status === 'cancelled') && (
            <div className="border-b border-border/70 bg-bg-base/45 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text-primary">
                    {running ? `正在初始化：${currentTask.currentStepLabel || '准备任务'}` : statusLabel(currentTask.status)}
                  </p>
                  <p className="mt-1 truncate text-xs text-text-muted">{currentTask.detail}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-accent">{progress.completed}/{progress.total}</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border">
                <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          )}

          <div className="space-y-5 px-5 py-5">
            {GROUPS.map(group => {
              const groupItems = items.filter(item => item.group === group.id)
              const groupDone = groupItems.filter(item => item.status === 'completed').length
              return (
                <section key={group.id} className="border-b border-border/60 pb-5 last:border-b-0">
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary">{group.label}</h3>
                      <p className="mt-0.5 text-xs text-text-muted">{group.description}</p>
                    </div>
                    <span className="text-xs text-text-muted">{groupDone}/{groupItems.length}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {groupItems.map(item => <InitializationItemRow key={item.id} item={item} />)}
                  </div>
                </section>
              )
            })}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-bg-elevated px-5 py-3">
          <div className="text-xs text-text-muted">
            {anotherTaskRunning ? `“${task?.projectName}”正在初始化，请等待该任务结束。` : running ? '任务正在后台运行，可以直接关闭此窗口。' : '所有写入均通过项目注册表工具完成。'}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {running && (
              <button type="button" onClick={() => void cancel()} className="inline-flex items-center gap-1.5 rounded border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10">
                <Square className="h-3 w-3 fill-current" /> 停止任务
              </button>
            )}
            {currentTask?.status === 'completed' && (
              <button type="button" onClick={() => setConfirmReinitialize(true)} className="rounded border border-amber-500/40 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/10">
                重新初始化
              </button>
            )}
            {(currentTask?.status === 'failed' || currentTask?.status === 'cancelled') && (
              <button type="button" onClick={handleResume} disabled={anotherTaskRunning} className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover disabled:opacity-40">
                继续未完成任务
              </button>
            )}
            {!currentTask && (
              <button
                type="button"
                onClick={handleStart}
                disabled={!idea.trim() || anotherTaskRunning}
                className="inline-flex items-center gap-1.5 rounded bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
              >
                <Sparkles className="h-3.5 w-3.5" /> 开始初始化
              </button>
            )}
          </div>
        </footer>
      </section>
      {confirmReinitialize && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="alertdialog" aria-modal="true" aria-label="确认重新初始化">
          <section className="w-full max-w-md rounded-lg border border-amber-500/35 bg-bg-elevated p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div>
                <h3 className="text-base font-semibold text-text-primary">确认重新初始化项目？</h3>
                <p className="mt-2 text-sm leading-6 text-text-secondary">
                  已完成的初始化记录将被重置，Agent 会重新生成全部世界观、故事设计和角色。现有设定可能被覆盖，角色、历史事件等列表内容可能新增。
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmReinitialize(false)} className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover">
                取消
              </button>
              <button
                type="button"
                onClick={() => { setConfirmReinitialize(false); handleStart() }}
                className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500"
              >
                确认重新初始化
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function InitializationItemRow({ item }: { item: ProjectInitializationItem }) {
  const icon = item.status === 'completed'
    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
    : item.status === 'running'
      ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent" />
      : item.status === 'failed'
        ? <AlertCircle className="h-3.5 w-3.5 text-red-400" />
        : <Circle className="h-3.5 w-3.5 text-text-muted/60" />
  return (
    <div className={`flex min-w-0 items-center gap-2 rounded border px-2.5 py-2 text-xs ${
      item.status === 'running' ? 'border-accent/40 bg-accent/5 text-text-primary' : 'border-border/60 bg-bg-base text-text-secondary'
    }`} title={item.error}>
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{item.label}</span>
    </div>
  )
}

function statusLabel(status: string): string {
  if (status === 'completed') return '项目初始化完成'
  if (status === 'failed') return '项目初始化失败'
  if (status === 'cancelled') return '项目初始化已停止'
  return '等待开始'
}
