import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot, CheckCircle2, CircleStop, History, Loader2, Play, RotateCcw,
  UserRound, Users, WandSparkles, Workflow,
} from 'lucide-react'
import { db } from '../../lib/db/schema'
import { adopt } from '../../lib/registry/adopt'
import {
  runPlotSimulation,
  type PlotSimulationStage,
} from '../../lib/simulation/plot-simulation-engine'
import type {
  AIModelRef,
  Character,
  Chapter,
  PlotSimulationSession,
  PlotSimulationTurn,
  Project,
} from '../../lib/types'
import { useAIConfigStore } from '../../stores/ai-config'
import { useCharacterStore } from '../../stores/character'
import { useChapterStore } from '../../stores/chapter'
import { useOutlineStore } from '../../stores/outline'
import { CHAPTER_WRITING_CONTEXT_SOURCES, dispatchAgentIntent } from '../../lib/agent/intents'
import AutoResizeTextarea from '../shared/AutoResizeTextarea'

export { applyCharacterArcAutoFill } from '../../lib/ai/character-driven-plot'

interface Props { project: Project }

export default function CharacterDrivenPlotPanel({ project }: Props) {
  const { characters, loadAll: loadCharacters, updateCharacter } = useCharacterStore()
  const { chapters, loadAll: loadChapters } = useChapterStore()
  const { nodes, loadAll: loadOutline } = useOutlineStore()
  const { providerConfigs, sceneBindings, activeModelRef } = useAIConfigStore()
  const [sessions, setSessions] = useState<PlotSimulationSession[]>([])
  const [activeSession, setActiveSession] = useState<PlotSimulationSession | null>(null)
  const [turns, setTurns] = useState<PlotSimulationTurn[]>([])
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<number>>(new Set())
  const [chapterId, setChapterId] = useState<number | null>(null)
  const [premise, setPremise] = useState('')
  const [goal, setGoal] = useState('')
  const [plannedTurns, setPlannedTurns] = useState(3)
  const [defaultCharacterModelRef, setDefaultCharacterModelRef] = useState<AIModelRef>(sceneBindings.settings ?? activeModelRef)
  const [narratorModelRef, setNarratorModelRef] = useState<AIModelRef>(sceneBindings.chapter ?? activeModelRef)
  const [stages, setStages] = useState<PlotSimulationStage[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const loadSessions = async () => {
    const rows = await db.plotSimulationSessions.where('projectId').equals(project.id!).reverse().sortBy('updatedAt')
    setSessions(rows)
  }

  useEffect(() => {
    void Promise.all([
      loadCharacters(project.id!),
      loadChapters(project.id!),
      loadOutline(project.id!),
      loadSessions(),
    ])
  }, [project.id, loadCharacters, loadChapters, loadOutline])

  useEffect(() => {
    if (selectedCharacterIds.size || !characters.length) return
    setSelectedCharacterIds(new Set(
      characters.filter(character => character.id != null && ['main', 'secondary'].includes(character.roleWeight)).map(character => character.id!),
    ))
  }, [characters, selectedCharacterIds.size])

  const chapterOptions = useMemo(() => chapters
    .map(chapter => ({ chapter, node: nodes.find(node => node.id === chapter.outlineNodeId) }))
    .sort((left, right) => (left.node?.order ?? left.chapter.order) - (right.node?.order ?? right.chapter.order)), [chapters, nodes])

  const selectedCharacters = characters.filter(character => character.id != null && selectedCharacterIds.has(character.id))
  const selectedChapter = chapters.find(chapter => chapter.id === chapterId)
  const selectedChapterNode = nodes.find(node => node.id === selectedChapter?.outlineNodeId)
  const targetWorldGroupId = selectedChapterNode?.worldGroupId ?? null
  const modelOptions = providerConfigs.flatMap(provider => provider.models.map(model => ({
    ref: { providerConfigId: provider.id, modelId: model.id },
    label: `${provider.name} / ${model.name}`,
  })))
  const canRun = Boolean(!running
    && selectedCharacters.length > 0
    && premise.trim()
    && goal.trim()
    && chapterId != null
    && (activeSession == null || plannedTurns > activeSession.currentTurn))

  const selectSession = async (session: PlotSimulationSession) => {
    if (running || session.id == null) return
    const savedTurns = await db.plotSimulationTurns.where('sessionId').equals(session.id).sortBy('turnNumber')
    setActiveSession(session)
    setTurns(savedTurns)
    setSelectedCharacterIds(new Set(session.selectedCharacterIds))
    setChapterId(session.chapterId ?? null)
    setPremise(session.premise)
    setGoal(session.goal)
    setPlannedTurns(session.plannedTurns)
    setDefaultCharacterModelRef(session.defaultCharacterModelRef ?? sceneBindings.settings ?? activeModelRef)
    setNarratorModelRef(session.narratorModelRef ?? sceneBindings.chapter ?? activeModelRef)
    setStages([])
    setError(session.error ?? '')
  }

  const resetDraft = () => {
    if (running) return
    setActiveSession(null)
    setTurns([])
    setStages([])
    setError('')
    setPremise('')
    setGoal('')
  }

  const createSession = async (): Promise<PlotSimulationSession & { id: number }> => {
    const title = premise.trim().slice(0, 32) || '剧情推演'
    const data = {
      sessionKey: createSessionKey(),
      title,
      premise: premise.trim(),
      goal: goal.trim(),
      status: 'draft' as const,
      worldGroupId: targetWorldGroupId,
      chapterId,
      selectedCharacterIds: [...selectedCharacterIds],
      narratorModelRef,
      defaultCharacterModelRef,
      plannedTurns,
      currentTurn: 0,
    }
    const result = await adopt({
      projectId: project.id!,
      worldGroupId: targetWorldGroupId,
      target: 'plotSimulationSessions',
      mode: 'add',
      data,
    })
    const id = result.written[0]?.id
    if (id == null) throw new Error(result.skipped[0]?.reason || '推演会话创建失败')
    const now = Date.now()
    return { ...data, id, projectId: project.id!, createdAt: now, updatedAt: now }
  }

  const run = async () => {
    if (!canRun) return
    setRunning(true)
    setError('')
    setStages([])
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const session = activeSession?.id != null
        ? { ...activeSession, id: activeSession.id, plannedTurns, narratorModelRef, defaultCharacterModelRef }
        : await createSession()
      if (activeSession?.id != null) {
        await adopt({
          projectId: project.id!,
          target: 'plotSimulationSessions',
          recordId: activeSession.id,
          mode: 'merge-diffs',
          data: { plannedTurns, narratorModelRef, defaultCharacterModelRef },
        })
      }
      setActiveSession(session)
      const completed = await runPlotSimulation({
        projectId: project.id!,
        session,
        characters: selectedCharacters,
        existingTurns: turns,
        providerConfigs,
        sceneBindings,
        activeModelRef,
        signal: controller.signal,
        onStage: stage => setStages(current => [...current, stage]),
      })
      const savedSession = await db.plotSimulationSessions.get(session.id)
      if (savedSession) setActiveSession(savedSession)
      setTurns(completed)
      await loadSessions()
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
      if (activeSession?.id != null) {
        const savedTurns = await db.plotSimulationTurns.where('sessionId').equals(activeSession.id).sortBy('turnNumber')
        setTurns(savedTurns)
      }
      await loadSessions()
    } finally {
      abortRef.current = null
      setRunning(false)
    }
  }

  const submitForChapterApproval = () => {
    const chapter = chapters.find(item => item.id === chapterId)
    if (!chapter?.id || !turns.length) return
    const transcript = turns.map(turn => ({
      turnNumber: turn.turnNumber,
      worldState: turn.worldState,
      characterActions: turn.characterActions,
      narration: turn.narration,
      summary: turn.summary,
      worldChanges: turn.worldChanges,
      unresolvedHooks: turn.unresolvedHooks,
    }))
    dispatchAgentIntent({
      type: 'simulation.to-chapter',
      title: '将推演结果写成章节正文',
      promptModuleKey: 'chapter.content',
      source: {
        project: { backend: 'dexie', projectId: project.id! },
        module: 'chapters-list',
        outlineNodeId: chapter.outlineNodeId,
        chapterId: chapter.id,
      },
      instruction: '基于已完成的多角色自主推演记录，整理成一章连续、完整、可直接阅读的小说正文。保留角色自主选择和世界裁决结果，消除 JSON/回合标签/流程说明；旁白负责动作、环境和必要心理活动。完成后必须提出 chapters/replace 审批方案，不得直接写入。',
      completionRequirement: {
        kind: 'change-proposal',
        target: 'chapters',
        mode: 'replace',
        recordId: chapter.id,
        requiredFields: ['content'],
        minTextLength: { content: 800 },
        requiredContextSources: CHAPTER_WRITING_CONTEXT_SOURCES,
        deliverableKind: 'chapter-draft',
      },
      payload: {
        simulationSessionId: activeSession?.id,
        premise,
        goal,
        transcript,
      },
    })
  }

  return (
    <div className="flex h-full min-h-[680px] flex-col overflow-hidden bg-bg-base">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-bg-surface px-4 py-3">
        <Workflow className="h-5 w-5 text-accent" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-text-primary">剧情自动推演</h2>
          <p className="text-xs text-text-muted">世界演化、角色自主决策、旁白裁决，最终经 Agent 审批写入正文</p>
        </div>
        <button type="button" onClick={resetDraft} disabled={running} className="rounded p-2 text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-40" title="新建推演">
          <RotateCcw className="h-4 w-4" />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="max-h-48 overflow-y-auto border-b border-border bg-bg-surface p-3 xl:max-h-none xl:border-b-0 xl:border-r">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-text-secondary"><History className="h-3.5 w-3.5" />推演记录</div>
          <div className="space-y-1">
            {sessions.map(session => (
              <button key={session.id} type="button" onClick={() => void selectSession(session)} className={`w-full rounded px-2 py-2 text-left ${activeSession?.id === session.id ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:bg-bg-hover'}`}>
                <div className="truncate text-xs font-medium">{session.title}</div>
                <div className="mt-0.5 text-[10px] text-text-muted">{session.currentTurn}/{session.plannedTurns} 回合 · {statusLabel(session.status)}</div>
              </button>
            ))}
            {!sessions.length && <p className="px-2 py-6 text-center text-xs text-text-muted">暂无推演记录</p>}
          </div>
        </aside>

        <div className="min-h-0 overflow-y-auto p-4">
          <section className="grid gap-3 border-b border-border pb-4 md:grid-cols-2">
            <label className="text-xs text-text-secondary">目标章节
              <select value={chapterId ?? ''} onChange={event => setChapterId(event.target.value ? Number(event.target.value) : null)} disabled={running || activeSession != null} className="mt-1 w-full rounded border border-border bg-bg-surface px-2 py-2 text-sm text-text-primary outline-none focus:border-accent">
                <option value="">选择要形成的章节</option>
                {chapterOptions.map(({ chapter, node }) => <option key={chapter.id} value={chapter.id}>{node?.title || chapter.title}</option>)}
              </select>
            </label>
            <label className="text-xs text-text-secondary">推演回合
              <input type="number" min={1} max={5} value={plannedTurns} onChange={event => setPlannedTurns(Math.min(5, Math.max(1, Number(event.target.value))))} disabled={running} className="mt-1 w-full rounded border border-border bg-bg-surface px-2 py-2 text-sm text-text-primary outline-none focus:border-accent" />
            </label>
            <label className="text-xs text-text-secondary">当前局面
              <AutoResizeTextarea value={premise} onChange={event => setPremise(event.target.value)} disabled={running || activeSession != null} minRows={3} placeholder="角色此刻所处的环境、冲突和已知信息" className="mt-1 w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent" />
            </label>
            <label className="text-xs text-text-secondary">推演目标
              <AutoResizeTextarea value={goal} onChange={event => setGoal(event.target.value)} disabled={running || activeSession != null} minRows={3} placeholder="希望探索的问题，不预设角色必须如何行动" className="mt-1 w-full rounded border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent" />
            </label>
          </section>

          <section className="border-b border-border py-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-text-primary"><Users className="h-4 w-4 text-accent" />参与角色与独立模型</div>
              <ModelSelect value={narratorModelRef} options={modelOptions} onChange={setNarratorModelRef} disabled={running} label="旁白" />
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              {characters.filter(character => character.id != null).map(character => {
                const selected = selectedCharacterIds.has(character.id!)
                const modelRef = character.simulationModelRef ?? defaultCharacterModelRef
                return (
                  <div key={character.id} className={`rounded border px-3 py-2 ${selected ? 'border-accent/50 bg-accent/5' : 'border-border bg-bg-surface'}`}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
                      <input type="checkbox" checked={selected} disabled={running || activeSession != null} onChange={() => setSelectedCharacterIds(current => toggleId(current, character.id!))} className="accent-accent" />
                      <UserRound className="h-4 w-4 text-text-muted" /><span className="min-w-0 flex-1 truncate">{character.name}</span>
                    </label>
                    {selected && <div className="mt-2 space-y-2">
                      <ModelSelect value={modelRef} options={modelOptions} disabled={running} onChange={ref => void updateCharacter(character.id!, { simulationModelRef: ref })} />
                      <input
                        type="text"
                        defaultValue={character.simulationInstructions || ''}
                        disabled={running}
                        onBlur={event => void updateCharacter(character.id!, { simulationInstructions: event.target.value })}
                        placeholder="角色自主行动约束（可选）"
                        className="w-full rounded border border-border bg-bg-base px-2 py-1 text-xs text-text-primary outline-none focus:border-accent"
                      />
                    </div>}
                  </div>
                )
              })}
            </div>
          </section>

          <div className="flex items-center gap-2 py-4">
            <button type="button" onClick={running ? () => abortRef.current?.abort() : () => void run()} disabled={!running && !canRun} className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40">
              {running ? <><CircleStop className="h-4 w-4" />停止推演</> : <><Play className="h-4 w-4" />{activeSession ? '继续推演' : '开始推演'}</>}
            </button>
            {running && <Loader2 className="h-4 w-4 animate-spin text-accent" />}
            {error && <span className="text-xs text-red-500">{error}</span>}
          </div>

          {stages.length > 0 && <section className="mb-4 border-l-2 border-accent/40 pl-3">
            <div className="mb-2 text-xs font-medium text-text-secondary">执行过程</div>
            {stages.map((stage, index) => <div key={`${stage.type}-${stage.turnNumber}-${index}`} className="flex items-center gap-2 py-1 text-xs text-text-muted"><CheckCircle2 className="h-3.5 w-3.5 text-accent" />{stage.label}</div>)}
          </section>}

          <section className="space-y-4">
            {turns.map(turn => <SimulationTurnView key={turn.id ?? turn.turnNumber} turn={turn} />)}
          </section>

          {turns.length > 0 && !running && <div className="sticky bottom-0 mt-5 flex items-center justify-between border-t border-border bg-bg-base/95 py-3 backdrop-blur">
            <span className="text-xs text-text-muted">推演记录不是正式手稿，提交后仍需在右侧审批</span>
            <button type="button" onClick={submitForChapterApproval} className="flex items-center gap-2 rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
              <Bot className="h-4 w-4" />生成正文并提交审批
            </button>
          </div>}
        </div>
      </div>
    </div>
  )
}

function SimulationTurnView({ turn }: { turn: PlotSimulationTurn }) {
  return <article className="border-t border-border pt-4 first:border-t-0">
    <div className="mb-2 flex items-center gap-2"><WandSparkles className="h-4 w-4 text-accent" /><h3 className="text-sm font-semibold text-text-primary">第 {turn.turnNumber} 回合</h3><span className="text-xs text-text-muted">{turn.summary}</span></div>
    <div className="mb-3 rounded border border-border bg-bg-surface px-3 py-2 text-xs text-text-secondary"><strong>世界压力：</strong>{turn.worldState.pressure}</div>
    <div className="mb-3 grid gap-2 md:grid-cols-2">
      {turn.characterActions.map(action => <div key={action.characterId} className="rounded border border-border bg-bg-surface px-3 py-2 text-xs text-text-secondary">
        <div className="mb-1 font-medium text-text-primary">{action.characterName}</div>
        <div><strong>行动：</strong>{action.action}</div>
        {action.dialogue && <div><strong>对白：</strong>“{action.dialogue}”</div>}
        {action.innerThought && <div className="text-text-muted"><strong>内心：</strong>{action.innerThought}</div>}
      </div>)}
    </div>
    <div className="whitespace-pre-wrap text-sm leading-7 text-text-primary">{turn.narration}</div>
  </article>
}

function ModelSelect({ value, options, onChange, disabled, label }: {
  value: AIModelRef
  options: Array<{ ref: AIModelRef; label: string }>
  onChange: (ref: AIModelRef) => void
  disabled?: boolean
  label?: string
}) {
  return <label className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-muted">
    {label && <span className="shrink-0">{label}</span>}
    <select value={modelRefKey(value)} onChange={event => onChange(parseModelRefKey(event.target.value))} disabled={disabled} className="min-w-0 flex-1 rounded border border-border bg-bg-base px-2 py-1 text-xs text-text-primary outline-none focus:border-accent disabled:opacity-50">
      {options.map(option => <option key={modelRefKey(option.ref)} value={modelRefKey(option.ref)}>{option.label}</option>)}
    </select>
  </label>
}

function modelRefKey(ref: AIModelRef): string { return `${ref.providerConfigId}:${ref.modelId}` }
function parseModelRefKey(value: string): AIModelRef {
  const [providerConfigId, modelId] = value.split(':')
  return { providerConfigId, modelId }
}
function toggleId(current: Set<number>, id: number): Set<number> {
  const next = new Set(current)
  next.has(id) ? next.delete(id) : next.add(id)
  return next
}
function statusLabel(status: PlotSimulationSession['status']): string {
  return { draft: '未开始', running: '进行中', completed: '已完成', failed: '可重试' }[status]
}
function createSessionKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `simulation-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function selectedSimulationCharacters(characters: Character[], ids: ReadonlySet<number>): Character[] {
  return characters.filter(character => character.id != null && ids.has(character.id))
}

export function simulationChapterLabel(chapter: Chapter, title?: string): string {
  return title || chapter.title || `章节 #${chapter.id}`
}
