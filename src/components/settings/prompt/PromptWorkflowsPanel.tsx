import { useState, useEffect } from 'react'
import { useRef } from 'react'
import {
  Play, Trash2, Copy, ArrowRight, Square,
  Sparkles, Check, X, Loader2, ChevronRight, Save, ClipboardCopy,
  Upload, Download, Plus, Edit3,
} from 'lucide-react'
import { useWorkflowStore } from '../../../stores/workflow'
import { usePromptStore } from '../../../stores/prompt'
import { useWorldviewStore } from '../../../stores/worldview'
import { useCreativeRulesStore } from '../../../stores/creative-rules'
import { useAIStream } from '../../../hooks/useAIStream'
import { renderPrompt } from '../../../lib/ai/prompt-engine'
import type { PromptWorkflow, PromptWorkflowStep, SaveTarget } from '../../../lib/types/workflow'
import type { Project } from '../../../lib/types'

interface Props {
  project?: Project
}

/** 工作流面板：列表 + Runner（在同一面板切换） */
export default function PromptWorkflowsPanel({ project }: Props = {}) {
  const workflows = useWorkflowStore(s => s.workflows)
  const cloneWorkflow = useWorkflowStore(s => s.clone)
  const removeWorkflow = useWorkflowStore(s => s.remove)
  const saveWorkflow = useWorkflowStore(s => s.save)
  const reloadWorkflows = useWorkflowStore(s => s.reload)
  const initWorkflows = useWorkflowStore(s => s.init)

  const [runningId, setRunningId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { initWorkflows() }, [initWorkflows])

  const handleExportAll = () => {
    const blob = new Blob([JSON.stringify(workflows, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `storyforge-workflows-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleImportClick = () => fileInputRef.current?.click()

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const items: unknown[] = Array.isArray(data) ? data : [data]
      const now = Date.now()
      let count = 0
      for (const raw of items) {
        if (typeof raw !== 'object' || raw === null) continue
        const r = raw as Record<string, unknown>
        if (typeof r.name !== 'string' || !Array.isArray(r.steps)) continue
        await saveWorkflow({
          scope: 'user',
          name: r.name,
          description: typeof r.description === 'string' ? r.description : '',
          genres: Array.isArray(r.genres) ? r.genres as string[] : undefined,
          steps: r.steps as PromptWorkflowStep[],
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        })
        count++
      }
      await reloadWorkflows()
      alert(`成功导入 ${count} 个工作流`)
    } catch (err) {
      alert(`导入失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleNew = async () => {
    const now = Date.now()
    const id = await saveWorkflow({
      scope: 'user',
      name: '新建工作流',
      description: '',
      steps: [],
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    })
    setEditingId(id)
  }

  if (runningId !== null) {
    const wf = workflows.find(w => w.id === runningId)
    if (!wf) {
      setRunningId(null)
      return null
    }
    return <WorkflowRunner workflow={wf} project={project} onClose={() => setRunningId(null)} />
  }

  if (editingId !== null) {
    const wf = workflows.find(w => w.id === editingId)
    if (!wf) {
      setEditingId(null)
      return null
    }
    return <WorkflowEditor workflow={wf} onClose={() => setEditingId(null)} />
  }

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text-primary mb-1">🔗 提示词工作流</h2>
          <p className="text-sm text-text-muted">
            一键跑完一段创作流程，每步可暂停审核。
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleNew}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 text-accent text-xs rounded hover:bg-accent/20"
          >
            <Plus className="w-3.5 h-3.5" /> 新建
          </button>
          <button
            onClick={handleImportClick}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-hover text-text-primary text-xs rounded hover:bg-bg-elevated"
          >
            <Upload className="w-3.5 h-3.5" /> 导入
          </button>
          <button
            onClick={handleExportAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-hover text-text-primary text-xs rounded hover:bg-bg-elevated"
          >
            <Download className="w-3.5 h-3.5" /> 导出全部
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </div>

      {workflows.length === 0 ? (
        <div className="text-center py-12 text-text-muted text-sm">加载中...</div>
      ) : (
        <div className="space-y-2">
          {workflows.map(w => (
            <div key={w.id} className="bg-bg-surface border border-border rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-text-primary truncate">{w.name}</h3>
                    {w.scope === 'system'
                      ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning">系统</span>
                      : <span className="text-[10px] px-1.5 py-0.5 rounded bg-info/15 text-info">我的</span>}
                    {w.isDefault && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent">★ 默认</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-text-secondary">{w.description}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setRunningId(w.id!)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white text-xs rounded hover:bg-accent-hover"
                  >
                    <Play className="w-3 h-3" /> 运行
                  </button>
                  {w.scope === 'user' && (
                    <button
                      onClick={() => setEditingId(w.id!)}
                      className="p-1.5 text-text-muted hover:text-text-primary"
                      title="编辑"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => cloneWorkflow(w.id!)}
                    className="p-1.5 text-text-muted hover:text-text-primary"
                    title="克隆"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  {w.scope === 'user' && (
                    <button
                      onClick={() => {
                        if (confirm(`删除工作流「${w.name}」？`)) removeWorkflow(w.id!)
                      }}
                      className="p-1.5 text-text-muted hover:text-error"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* 步骤预览 */}
              <div className="flex items-center gap-1 flex-wrap mt-2">
                {w.steps.map((s, i) => (
                  <span key={s.stepId} className="flex items-center gap-1 text-xs">
                    <span className="px-2 py-0.5 bg-bg-elevated text-text-secondary rounded">
                      {i + 1}. {s.label}
                    </span>
                    {i < w.steps.length - 1 && <ArrowRight className="w-3 h-3 text-text-muted" />}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-text-muted">
                共 {w.steps.length} 步 · {w.steps.filter(s => s.userConfirmRequired).length} 步需用户确认
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 工作流执行器 ─────────────────────────────────────────────────────────

interface RunnerProps {
  workflow: PromptWorkflow
  project?: Project
  onClose: () => void
}

interface StepResult {
  stepId: string
  output: string
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed'
  error?: string
}

function WorkflowRunner({ workflow, project, onClose }: RunnerProps) {
  const ai = useAIStream()
  const { worldview, saveWorldview, storyCore, saveStoryCore, loadAll: loadWorldview } = useWorldviewStore()
  const { creativeRules, save: saveCreativeRules, loadAll: loadCreativeRules } = useCreativeRulesStore()
  const [savedSteps, setSavedSteps] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (project?.id) {
      loadWorldview(project.id)
      loadCreativeRules(project.id)
    }
  }, [project?.id, loadWorldview, loadCreativeRules])

  /** 写入对应模块 */
  const handleSaveTarget = async (stepId: string, output: string, target: SaveTarget) => {
    if (!project?.id) {
      alert('未关联项目，无法自动保存。请进入某个项目后再运行。')
      return
    }
    try {
      if (target.type === 'worldview-field') {
        const existing = (worldview?.[target.field as keyof typeof worldview] as string) || ''
        const next = target.mode === 'append' && existing ? `${existing}\n\n${output}` : output
        await saveWorldview({ projectId: project.id, [target.field]: next })
      } else if (target.type === 'storyCore-field') {
        const existing = (storyCore?.[target.field as keyof typeof storyCore] as string) || ''
        const next = target.mode === 'append' && existing ? `${existing}\n\n${output}` : output
        await saveStoryCore({ projectId: project.id, [target.field]: next })
      } else if (target.type === 'creativeRules-field') {
        const existing = (creativeRules?.[target.field as keyof typeof creativeRules] as string) || ''
        const next = target.mode === 'append' && existing ? `${existing}\n\n${output}` : output
        await saveCreativeRules({ projectId: project.id, [target.field]: next })
      }
      setSavedSteps(prev => new Set(prev).add(stepId))
    } catch (e) {
      alert(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const targetLabel = (target: SaveTarget): string => {
    const fieldMap: Record<string, string> = {
      worldOrigin: '世界起源', powerHierarchy: '力量层次',
      historyLine: '世界历史线', summary: '世界观摘要',
      logline: '一句话故事', concept: '故事概念', theme: '主题',
      writingStyle: '写作风格', toneAndMood: '基调氛围',
    }
    const label = fieldMap[target.field] || target.field
    if (target.type === 'worldview-field') return `世界观.${label}`
    if (target.type === 'storyCore-field') return `故事.${label}`
    return `创作规则.${label}`
  }
  const [results, setResults] = useState<Map<string, StepResult>>(() => {
    const m = new Map<string, StepResult>()
    workflow.steps.forEach(s => m.set(s.stepId, { stepId: s.stepId, output: '', status: 'pending' }))
    return m
  })
  const [currentIndex, setCurrentIndex] = useState(0)
  const [globalStatus, setGlobalStatus] = useState<'idle' | 'running' | 'paused' | 'completed' | 'aborted'>('idle')

  const updateResult = (stepId: string, patch: Partial<StepResult>) => {
    setResults(prev => {
      const next = new Map(prev)
      const old = next.get(stepId)
      if (old) next.set(stepId, { ...old, ...patch })
      return next
    })
  }

  /** 执行第 idx 步 */
  const runStep = async (idx: number) => {
    const step = workflow.steps[idx]
    if (!step) return
    const tpl = usePromptStore.getState().getActive(step.promptModuleKey)

    // 拼上下文：前一步的输出作为 inputMapping
    const ctx: Record<string, string | number | undefined> = {}
    const prevStep = workflow.steps[idx - 1]
    if (prevStep && step.inputMapping) {
      const prevResult = results.get(prevStep.stepId)
      if (prevResult?.output) {
        for (const [from, to] of Object.entries(step.inputMapping)) {
          if (from === 'previousOutput') ctx[to] = prevResult.output
        }
      }
    }
    if (step.userHint) ctx.userHint = step.userHint

    updateResult(step.stepId, { status: 'running', output: '', error: undefined })

    try {
      const { messages } = renderPrompt(tpl, ctx, {
        parameterValues: step.parameterValues,
      })
      const output = await ai.start(messages)
      updateResult(step.stepId, { status: 'done', output })
      setCurrentIndex(idx + 1)

      // 是否暂停等用户确认
      if (step.userConfirmRequired && idx < workflow.steps.length - 1) {
        setGlobalStatus('paused')
      } else if (idx === workflow.steps.length - 1) {
        setGlobalStatus('completed')
      } else {
        // 继续下一步
        await runStep(idx + 1)
      }
    } catch (e) {
      updateResult(step.stepId, {
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      })
      setGlobalStatus('paused')
    }
  }

  const handleStart = () => {
    setGlobalStatus('running')
    runStep(currentIndex)
  }

  const handleContinue = () => {
    setGlobalStatus('running')
    runStep(currentIndex)
  }

  const handleSkip = (stepId: string) => {
    updateResult(stepId, { status: 'skipped' })
    setCurrentIndex(prev => prev + 1)
  }

  const handleRetryStep = (idx: number) => {
    setGlobalStatus('running')
    runStep(idx)
  }

  const handleAbort = () => {
    ai.stop()
    setGlobalStatus('aborted')
  }

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text-primary">▶ 运行：{workflow.name}</h2>
          <p className="mt-0.5 text-xs text-text-muted">{workflow.description}</p>
        </div>
        <div className="flex items-center gap-2">
          {globalStatus === 'idle' && (
            <button
              onClick={handleStart}
              className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm rounded hover:bg-accent-hover"
            >
              <Play className="w-4 h-4" /> 开始
            </button>
          )}
          {globalStatus === 'running' && (
            <button
              onClick={handleAbort}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-error/10 text-error text-sm rounded hover:bg-error/20"
            >
              <Square className="w-4 h-4" /> 中止
            </button>
          )}
          {globalStatus === 'paused' && (
            <button
              onClick={handleContinue}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded hover:bg-accent-hover"
            >
              <Play className="w-4 h-4" /> 继续
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-text-secondary text-sm rounded hover:bg-bg-hover"
          >
            返回列表
          </button>
        </div>
      </div>

      {/* 全局状态 */}
      {globalStatus !== 'idle' && (
        <div className={`px-3 py-2 rounded text-xs ${
          globalStatus === 'completed' ? 'bg-success/10 text-success' :
          globalStatus === 'aborted' ? 'bg-error/10 text-error' :
          globalStatus === 'paused' ? 'bg-warning/10 text-warning' :
          'bg-info/10 text-info'
        }`}>
          {globalStatus === 'running' && `▶ 正在运行第 ${currentIndex + 1} / ${workflow.steps.length} 步...`}
          {globalStatus === 'paused' && `⏸ 已暂停（第 ${currentIndex + 1} 步等待你审核）`}
          {globalStatus === 'completed' && `✓ 工作流完成`}
          {globalStatus === 'aborted' && `✗ 已中止`}
        </div>
      )}

      {/* 步骤列表 */}
      <div className="space-y-2">
        {workflow.steps.map((step, idx) => (
          <StepCard
            key={step.stepId}
            step={step}
            index={idx}
            result={results.get(step.stepId)!}
            isCurrent={idx === currentIndex && globalStatus === 'running'}
            onSkip={() => handleSkip(step.stepId)}
            onRetry={() => handleRetryStep(idx)}
            onSave={(output, target) => handleSaveTarget(step.stepId, output, target)}
            saved={savedSteps.has(step.stepId)}
            targetLabel={targetLabel}
            hasProject={!!project?.id}
          />
        ))}
      </div>

      {globalStatus === 'completed' && (
        <div className="bg-bg-surface border border-success/30 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-success mb-2">✓ 全部完成</h3>
          <p className="text-xs text-text-secondary mb-3">
            可以把每步输出复制到对应模块（角色 / 大纲 / 章节正文等）。
            后续 Phase 可以做"一键写入"自动化。
          </p>
        </div>
      )}
    </div>
  )
}

function StepCard({
  step, index, result, isCurrent, onSkip, onRetry,
  onSave, saved, targetLabel, hasProject,
}: {
  step: PromptWorkflowStep
  index: number
  result: StepResult
  isCurrent: boolean
  onSkip: () => void
  onRetry: () => void
  onSave: (output: string, target: SaveTarget) => void
  saved: boolean
  targetLabel: (target: SaveTarget) => string
  hasProject: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (!result.output) return
    navigator.clipboard.writeText(result.output).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const statusIcon = {
    pending:  <ChevronRight className="w-4 h-4 text-text-muted" />,
    running:  <Loader2 className="w-4 h-4 text-accent animate-spin" />,
    done:     <Check className="w-4 h-4 text-success" />,
    skipped:  <X className="w-4 h-4 text-text-muted" />,
    failed:   <X className="w-4 h-4 text-error" />,
  }[result.status]

  const borderClass = isCurrent ? 'border-accent' :
    result.status === 'done' ? 'border-success/40' :
    result.status === 'failed' ? 'border-error/40' :
    'border-border'

  return (
    <div className={`bg-bg-surface border-2 rounded-xl overflow-hidden ${borderClass}`}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 p-3 hover:bg-bg-hover"
      >
        {statusIcon}
        <span className="text-text-muted text-xs w-6">{index + 1}.</span>
        <span className="text-sm font-medium text-text-primary">{step.label}</span>
        <span className="text-xs text-text-muted">→ {step.promptModuleKey}</span>
        {step.userConfirmRequired && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning">⏸ 需确认</span>
        )}
        <span className="ml-auto text-xs text-text-muted">
          {result.status === 'done' && `${result.output.length} 字`}
          {result.status === 'failed' && '失败'}
          {result.status === 'skipped' && '已跳过'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border p-3 space-y-2 bg-bg-base">
          {step.userHint && (
            <p className="text-xs text-text-muted">💡 {step.userHint}</p>
          )}
          {result.status === 'pending' && (
            <p className="text-xs text-text-muted">待执行</p>
          )}
          {result.status === 'running' && (
            <p className="text-xs text-accent flex items-center gap-1">
              <Sparkles className="w-3 h-3 animate-pulse" /> AI 生成中...
            </p>
          )}
          {result.output && (
            <pre className="text-xs text-text-primary whitespace-pre-wrap font-sans max-h-64 overflow-y-auto p-2 bg-bg-surface rounded">
              {result.output}
            </pre>
          )}
          {result.error && (
            <p className="text-xs text-error">⚠ {result.error}</p>
          )}
          {(result.status === 'done' || result.status === 'failed') && (
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <button
                onClick={onRetry}
                className="text-xs text-accent hover:underline"
              >
                重新生成
              </button>
              {result.status === 'done' && (
                <>
                  <span className="text-text-muted">·</span>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
                  >
                    {copied ? <Check className="w-3 h-3 text-success" /> : <ClipboardCopy className="w-3 h-3" />}
                    {copied ? '已复制' : '复制'}
                  </button>
                  {step.saveTarget && (
                    <>
                      <span className="text-text-muted">·</span>
                      <button
                        onClick={() => onSave(result.output, step.saveTarget!)}
                        disabled={saved || !hasProject}
                        title={!hasProject ? '需先进入项目' : `自动写入 ${targetLabel(step.saveTarget)}`}
                        className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded ${
                          saved
                            ? 'bg-success/15 text-success'
                            : !hasProject
                              ? 'text-text-muted opacity-50 cursor-not-allowed'
                              : 'bg-accent/10 text-accent hover:bg-accent/20'
                        }`}
                      >
                        {saved ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
                        {saved ? `已存到 ${targetLabel(step.saveTarget)}` : `保存到 ${targetLabel(step.saveTarget)}`}
                      </button>
                    </>
                  )}
                </>
              )}
              {result.status !== 'done' && (
                <>
                  <span className="text-text-muted">·</span>
                  <button
                    onClick={onSkip}
                    className="text-xs text-text-secondary hover:underline"
                  >
                    跳过此步
                  </button>
                </>
              )}
            </div>
          )}
          {result.status === 'pending' && isCurrent && (
            <button
              onClick={onSkip}
              className="text-xs text-text-secondary hover:underline"
            >
              跳过此步
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── 工作流编辑器（用户工作流可深度编辑） ───────────────────────────────────

const ALL_MODULE_KEYS_FOR_WORKFLOW = [
  'worldview.dimension', 'character.generate', 'character.dimension',
  'outline.volume', 'outline.chapter',
  'chapter.content', 'chapter.continue', 'chapter.polish', 'chapter.expand', 'chapter.de-ai',
  'foreshadow.generate', 'story.generate', 'rules.generate', 'detail.scene',
  'geography.concept-map', 'geography.image-map-prompt',
] as const

const SAVE_TARGET_PRESETS = [
  { label: '不自动保存（仅复制）', value: '' },
  { label: '世界观.世界起源', value: 'worldview-field:worldOrigin' },
  { label: '世界观.力量层次', value: 'worldview-field:powerHierarchy' },
  { label: '世界观.世界历史线', value: 'worldview-field:historyLine' },
  { label: '世界观.世界观摘要', value: 'worldview-field:summary' },
  { label: '故事.一句话故事', value: 'storyCore-field:logline' },
  { label: '故事.故事概念', value: 'storyCore-field:concept' },
  { label: '故事.主题', value: 'storyCore-field:theme' },
  { label: '故事.核心冲突', value: 'storyCore-field:centralConflict' },
  { label: '故事.故事主线', value: 'storyCore-field:mainPlot' },
  { label: '创作规则.写作风格', value: 'creativeRules-field:writingStyle' },
  { label: '创作规则.基调氛围', value: 'creativeRules-field:toneAndMood' },
] as const

function WorkflowEditor({ workflow, onClose }: { workflow: PromptWorkflow; onClose: () => void }) {
  const saveWorkflow = useWorkflowStore(s => s.save)
  const removeWorkflow = useWorkflowStore(s => s.remove)
  const [draft, setDraft] = useState<PromptWorkflow>(workflow)
  const [dirty, setDirty] = useState(false)

  const update = (patch: Partial<PromptWorkflow>) => {
    setDraft(d => ({ ...d, ...patch }))
    setDirty(true)
  }

  const updateStep = (idx: number, patch: Partial<PromptWorkflowStep>) => {
    setDraft(d => ({
      ...d,
      steps: d.steps.map((s, i) => i === idx ? { ...s, ...patch } : s),
    }))
    setDirty(true)
  }

  const addStep = () => {
    setDraft(d => ({
      ...d,
      steps: [...d.steps, {
        stepId: `s-${Math.random().toString(36).slice(2, 10)}`,
        label: `步骤 ${d.steps.length + 1}`,
        promptModuleKey: 'chapter.content',
        userConfirmRequired: false,
      }],
    }))
    setDirty(true)
  }

  const removeStep = (idx: number) => {
    setDraft(d => ({ ...d, steps: d.steps.filter((_, i) => i !== idx) }))
    setDirty(true)
  }

  const moveStep = (idx: number, dir: -1 | 1) => {
    setDraft(d => {
      const next = [...d.steps]
      const target = idx + dir
      if (target < 0 || target >= next.length) return d
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return { ...d, steps: next }
    })
    setDirty(true)
  }

  const handleSave = async () => {
    await saveWorkflow(draft)
    setDirty(false)
    alert('已保存')
  }

  const saveTargetToValue = (st?: SaveTarget): string => {
    if (!st) return ''
    return `${st.type}:${st.field}`
  }

  const valueToSaveTarget = (v: string): SaveTarget | undefined => {
    if (!v) return undefined
    const [type, field] = v.split(':')
    return { type: type as SaveTarget['type'], field, mode: 'replace' }
  }

  return (
    <div className="p-5 space-y-4">
      {/* 顶栏 */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-text-primary">✏️ 编辑工作流</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={!dirty}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-sm rounded hover:bg-accent-hover disabled:opacity-40"
          >
            <Save className="w-4 h-4" /> 保存{dirty && ' *'}
          </button>
          <button
            onClick={() => {
              if (dirty && !confirm('未保存的更改将丢失，确认返回？')) return
              onClose()
            }}
            className="px-3 py-1.5 text-text-secondary text-sm rounded hover:bg-bg-hover"
          >
            返回
          </button>
        </div>
      </div>

      {/* 元信息 */}
      <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
        <div>
          <label className="block text-xs text-text-secondary mb-1">名称</label>
          <input
            value={draft.name}
            onChange={e => update({ name: e.target.value })}
            className="w-full px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs text-text-secondary mb-1">描述</label>
          <textarea
            value={draft.description}
            onChange={e => update({ description: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* 步骤列表 */}
      <div className="bg-bg-surface border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-primary">步骤（{draft.steps.length}）</h3>
          <button
            onClick={addStep}
            className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded"
          >
            <Plus className="w-3 h-3" /> 加一步
          </button>
        </div>
        {draft.steps.length === 0 ? (
          <p className="text-xs text-text-muted py-3 text-center">还没有步骤，点上方「加一步」开始。</p>
        ) : (
          <div className="space-y-3">
            {draft.steps.map((s, idx) => (
              <div key={s.stepId} className="bg-bg-base border border-border rounded p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-text-muted text-xs flex-shrink-0">{idx + 1}.</span>
                  <input
                    value={s.label}
                    onChange={e => updateStep(idx, { label: e.target.value })}
                    placeholder="步骤名"
                    className="flex-1 px-2 py-1 bg-bg-surface border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                  />
                  <button onClick={() => moveStep(idx, -1)} disabled={idx === 0} className="px-1 text-text-muted hover:text-text-primary disabled:opacity-30">↑</button>
                  <button onClick={() => moveStep(idx, 1)} disabled={idx === draft.steps.length - 1} className="px-1 text-text-muted hover:text-text-primary disabled:opacity-30">↓</button>
                  <button onClick={() => removeStep(idx)} className="px-1 text-text-muted hover:text-error">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-text-muted mb-0.5">提示词模块</label>
                    <select
                      value={s.promptModuleKey}
                      onChange={e => updateStep(idx, { promptModuleKey: e.target.value as PromptWorkflowStep['promptModuleKey'] })}
                      className="w-full px-2 py-1 bg-bg-surface border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                    >
                      {ALL_MODULE_KEYS_FOR_WORKFLOW.map(k => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-text-muted mb-0.5">自动保存目标</label>
                    <select
                      value={saveTargetToValue(s.saveTarget)}
                      onChange={e => updateStep(idx, { saveTarget: valueToSaveTarget(e.target.value) })}
                      className="w-full px-2 py-1 bg-bg-surface border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                    >
                      {SAVE_TARGET_PRESETS.map(p => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-text-muted mb-0.5">给 AI 的提示（userHint）</label>
                  <textarea
                    value={s.userHint || ''}
                    onChange={e => updateStep(idx, { userHint: e.target.value })}
                    rows={2}
                    placeholder="如：请用一句话讲清楚这部小说要讲什么"
                    className="w-full px-2 py-1 bg-bg-surface border border-border rounded text-xs text-text-primary resize-none focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <label className="flex items-center gap-1 text-text-secondary">
                    <input
                      type="checkbox"
                      checked={s.userConfirmRequired || false}
                      onChange={e => updateStep(idx, { userConfirmRequired: e.target.checked })}
                      className="accent-accent"
                    />
                    本步执行后暂停等用户确认
                  </label>
                  {idx > 0 && (
                    <label className="flex items-center gap-1 text-text-secondary">
                      <input
                        type="checkbox"
                        checked={!!s.inputMapping?.previousOutput}
                        onChange={e => updateStep(idx, {
                          inputMapping: e.target.checked ? { previousOutput: 'previousOutput' } : undefined,
                        })}
                        className="accent-accent"
                      />
                      把上一步输出当作上下文
                    </label>
                  )}
                </div>
                {idx > 0 && s.inputMapping?.previousOutput && (
                  <input
                    value={s.inputMapping.previousOutput}
                    onChange={e => updateStep(idx, { inputMapping: { previousOutput: e.target.value } })}
                    placeholder="变量名（如 worldContext / characters）"
                    className="w-full px-2 py-1 bg-bg-surface border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部删除（仅用户工作流） */}
      {draft.scope === 'user' && draft.id && (
        <button
          onClick={() => {
            if (confirm(`删除工作流「${draft.name}」？此操作不可恢复。`)) {
              removeWorkflow(draft.id!)
              onClose()
            }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-error text-xs hover:bg-error/10 rounded"
        >
          <Trash2 className="w-3 h-3" /> 删除工作流
        </button>
      )}
    </div>
  )
}
