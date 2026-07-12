import { useMemo, useState } from 'react'
import { Bot, Database, FileSearch2, Search, WandSparkles } from 'lucide-react'
import type { Project } from '../../lib/types'
import { dispatchAgentIntent } from '../../lib/agent/intents'
import { projectRagSourceTables } from '../../lib/retrieval/retrieval'
import AutoResizeTextarea from '../shared/AutoResizeTextarea'

export type BookEditMode = 'scan' | 'edit'
export type BookEditScope = 'all' | 'manuscript' | 'structure' | 'characters' | 'world'

const SCOPE_CANDIDATES: Record<Exclude<BookEditScope, 'all'>, readonly string[]> = {
  manuscript: ['chapters', 'chapterRevisions', 'detailedOutlines', 'emotionBeatCards'],
  structure: ['outlineNodes', 'storyArcs', 'foreshadows', 'storyTimelineEvents', 'plotSimulationSessions', 'plotSimulationTurns'],
  characters: ['characters', 'characterRelations', 'stateCards', 'temporalFacts'],
  world: [
    'worldviews', 'worldRulesProfiles', 'worldGroups', 'worldNodes', 'geographies',
    'histories', 'historicalKeywords', 'historicalTimelineEvents', 'powerSystems',
    'codexCategories', 'codexEntries', 'importantLocations', 'itemLedger', 'references',
  ],
}

const SCOPE_OPTIONS: readonly { value: BookEditScope; label: string }[] = [
  { value: 'all', label: '全部数据' },
  { value: 'manuscript', label: '正文' },
  { value: 'structure', label: '大纲与剧情' },
  { value: 'characters', label: '角色与事实' },
  { value: 'world', label: '世界与设定' },
]

export function bookEditScopeTables(scope: BookEditScope): string[] | undefined {
  if (scope === 'all') return undefined
  const registered = new Set(projectRagSourceTables())
  return SCOPE_CANDIDATES[scope].filter(table => registered.has(table))
}

export default function BookEditorPanel({ project }: { project: Project }) {
  const allTables = useMemo(() => projectRagSourceTables(), [])
  const [mode, setMode] = useState<BookEditMode>('edit')
  const [scope, setScope] = useState<BookEditScope>('all')
  const [instruction, setInstruction] = useState('')
  const [exactQuery, setExactQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [constraints, setConstraints] = useState('')
  const sourceTables = useMemo(() => bookEditScopeTables(scope), [scope])
  const scopeLabel = SCOPE_OPTIONS.find(option => option.value === scope)?.label ?? '全部数据'

  const run = () => {
    const task = instruction.trim()
    if (!task) return
    const exact = exactQuery.trim()
    const next = replacement.trim()
    const isEdit = mode === 'edit'
    dispatchAgentIntent({
      type: isEdit ? 'book.edit.apply' : 'book.edit.scan',
      title: isEdit ? '全书查找并调整' : '全书扫描报告',
      promptModuleKey: 'book.edit',
      source: {
        project: { backend: 'dexie', projectId: project.id! },
        module: 'book-editor',
      },
      instruction: isEdit
        ? `扫描指定范围，找出所有受“${task}”影响的项目数据，并逐批生成可审批的修改方案。${exact ? `精确词“${exact}”必须使用 exact 模式分页读到 nextOffset=null。` : ''}每次提案获批后继续处理剩余命中，直到全部核对完成。`
        : `扫描指定范围并输出“${task}”的 Markdown 命中报告。${exact ? `精确词“${exact}”必须使用 exact 模式分页读到 nextOffset=null。` : ''}本次只读，禁止提出或提交修改。`,
      payload: {
        instruction: task,
        mode,
        modeLabel: isEdit ? '查找并提出调整' : '只扫描并生成报告',
        scope,
        scopeLabel,
        sourceTables,
        exactQuery: exact,
        replacement: next,
        constraints: constraints.trim(),
      },
    })
  }

  return (
    <div className="flex h-full min-h-[680px] flex-col overflow-hidden bg-bg-base">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-bg-surface px-5 py-4">
        <FileSearch2 className="h-5 w-5 text-accent" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-text-primary">全书编辑</h2>
          <p className="text-xs text-text-muted">跨正文、大纲、角色和设定进行全库检索，修改经 Agent 审批后写入</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <Database className="h-3.5 w-3.5" /> {allTables.length} 个可检索数据表
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-border px-5 py-4">
          <div className="mb-2 text-xs font-medium text-text-secondary">执行方式</div>
          <div className="inline-flex rounded-md border border-border bg-bg-surface p-0.5">
            <button type="button" onClick={() => setMode('scan')} className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs ${mode === 'scan' ? 'bg-bg-hover text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>
              <Search className="h-3.5 w-3.5" />只扫描
            </button>
            <button type="button" onClick={() => setMode('edit')} className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs ${mode === 'edit' ? 'bg-accent text-white shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>
              <WandSparkles className="h-3.5 w-3.5" />查找并调整
            </button>
          </div>
        </section>

        <section className="border-b border-border px-5 py-4">
          <div className="mb-2 text-xs font-medium text-text-secondary">检索范围</div>
          <div className="flex flex-wrap gap-2">
            {SCOPE_OPTIONS.map(option => {
              const count = option.value === 'all' ? allTables.length : (bookEditScopeTables(option.value)?.length ?? 0)
              return <button
                type="button"
                key={option.value}
                onClick={() => setScope(option.value)}
                className={`rounded-md border px-3 py-1.5 text-xs ${scope === option.value ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-bg-surface text-text-secondary hover:bg-bg-hover'}`}
              >
                {option.label} <span className="ml-1 text-[10px] opacity-70">{count}</span>
              </button>
            })}
          </div>
        </section>

        <section className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.6fr)]">
          <div className="space-y-4">
            <label className="block text-xs text-text-secondary">
              编辑任务
              <AutoResizeTextarea
                value={instruction}
                onChange={event => setInstruction(event.target.value)}
                minRows={5}
                maxRows={12}
                placeholder="例如：统一角色称谓；找出所有与新世界规则冲突的内容；调整主角在前十章的行为动机"
                className="mt-1.5 w-full rounded-md border border-border bg-bg-surface px-3 py-2 text-sm leading-6 text-text-primary outline-none focus:border-accent"
              />
            </label>
            <label className="block text-xs text-text-secondary">
              额外限制
              <AutoResizeTextarea
                value={constraints}
                onChange={event => setConstraints(event.target.value)}
                minRows={3}
                maxRows={8}
                placeholder="例如：不要修改历史版本；对白中的绰号保持不变；只处理第 1-20 章"
                className="mt-1.5 w-full rounded-md border border-border bg-bg-surface px-3 py-2 text-sm leading-6 text-text-primary outline-none focus:border-accent"
              />
            </label>
          </div>

          <div className="space-y-4 border-l-0 border-border lg:border-l lg:pl-4">
            <div>
              <div className="text-xs font-medium text-text-secondary">{mode === 'edit' ? '精确替换（可选）' : '精确查找（可选）'}</div>
              <p className="mt-1 text-[11px] text-text-muted">填写后会使用分页精确扫描，直到核对全部命中。</p>
            </div>
            <label className="block text-xs text-text-secondary">
              查找
              <input value={exactQuery} onChange={event => setExactQuery(event.target.value)} placeholder="需要找全的原词或短句" className="mt-1.5 w-full rounded-md border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent" />
            </label>
            {mode === 'edit' && <label className="block text-xs text-text-secondary">
              建议替换为
              <input value={replacement} onChange={event => setReplacement(event.target.value)} placeholder="留空则由 Agent 按语境分别调整" className="mt-1.5 w-full rounded-md border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent" />
            </label>}
            <div className="pt-2">
              <button
                type="button"
                onClick={run}
                disabled={!instruction.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Bot className="h-4 w-4" />{mode === 'edit' ? '交给 Agent 查找并调整' : '交给 Agent 扫描全书'}
              </button>
              <p className="mt-2 text-center text-[11px] text-text-muted">
                {sourceTables ? `限定 ${sourceTables.length} 个数据表` : '覆盖全部项目数据'} · {mode === 'edit' ? '修改逐批确认' : '只读报告，不修改项目'}
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
