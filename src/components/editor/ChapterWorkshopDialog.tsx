import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  Loader2,
  RotateCcw,
  Square,
  X,
} from 'lucide-react'
import { useAIStream } from '../../hooks/useAIStream'
import { streamChat } from '../../lib/ai/client'
import type { AIConfig, AIModelRef, ChatMessage, Project } from '../../lib/types'
import { useAIConfigStore } from '../../stores/ai-config'
import {
  CHAPTER_WORKSHOP_NODE_IDS,
  createChapterWorkshopNodes,
  runGenerationNode,
  type ChapterWorkshopArtifacts,
  type ChapterWorkshopNodeId,
} from '../../lib/generation-pipeline'
import PromptPreviewGate, { type PromptPreviewField } from '../shared/PromptPreviewGate'

interface ChapterWorkshopDialogProps {
  project: Project
  worldGroupId: number | null
  outlineNodeId: number
  chapterId: number
  chapterTitle: string
  chapterSummary: string
  userHint: string
  sourceKeys: string[]
  aiConfig: AIConfig
  onClose: () => void
  onComplete: (finalContent: string, artifacts: ChapterWorkshopArtifacts) => Promise<void> | void
}

interface CandidateResult {
  key: string
  label: string
  content: string
  error?: string
}

function modelRefKey(ref: AIModelRef): string {
  return `${ref.providerConfigId}:${ref.modelId}`
}

function messagesToFields(messages: readonly ChatMessage[]): PromptPreviewField[] {
  return messages.map((message, index) => ({
    id: `${message.role}-${index}`,
    label: message.role === 'system'
      ? 'System Prompt'
      : message.role === 'assistant'
        ? 'Assistant 消息'
        : 'User Prompt（已拼接项目上下文）',
    value: message.content,
    description: message.role === 'user'
      ? '包含经 CONTEXT_SOURCES 装配的章节上下文和已确认阶段产物。'
      : undefined,
  }))
}

export default function ChapterWorkshopDialog({
  project,
  worldGroupId,
  outlineNodeId,
  chapterId,
  chapterTitle,
  chapterSummary,
  userHint,
  sourceKeys,
  aiConfig,
  onClose,
  onComplete,
}: ChapterWorkshopDialogProps) {
  const ai = useAIStream()
  const providerConfigs = useAIConfigStore(state => state.providerConfigs)
  const sceneBindings = useAIConfigStore(state => state.sceneBindings)
  const activeModelRef = useAIConfigStore(state => state.activeModelRef)
  const nodes = useMemo(() => createChapterWorkshopNodes(), [])
  const availableModels = useMemo(() => providerConfigs.flatMap(provider => (
    provider.models.map(model => ({
      ref: { providerConfigId: provider.id, modelId: model.id },
      key: modelRefKey({ providerConfigId: provider.id, modelId: model.id }),
      label: `${provider.name} / ${model.name}`,
    }))
  )), [providerConfigs])
  const [selectedModelKeys, setSelectedModelKeys] = useState<string[]>(() => {
    const preferred = modelRefKey(sceneBindings.chapter ?? activeModelRef)
    return [
      preferred,
      ...availableModels.map(model => model.key).filter(key => key !== preferred),
    ].slice(0, Math.min(3, availableModels.length))
  })
  const [currentIndex, setCurrentIndex] = useState(0)
  const [artifacts, setArtifacts] = useState<ChapterWorkshopArtifacts>({})
  const [draft, setDraft] = useState('')
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[] | null>(null)
  const [assembling, setAssembling] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [candidateGenerating, setCandidateGenerating] = useState(false)
  const [candidateResults, setCandidateResults] = useState<CandidateResult[]>([])
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null)
  const candidateControllers = useRef<AbortController[]>([])
  const currentNode = nodes[currentIndex]
  const isBusy = ai.isStreaming || candidateGenerating

  useEffect(() => {
    if (ai.output) setDraft(ai.output)
  }, [ai.output])

  useEffect(() => {
    setDraft(artifacts[currentNode.id] ?? '')
    setLocalError(null)
    ai.reset()
    // currentNode.id 是切换阶段的稳定边界；ai.reset 已由 hook memo 化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNode.id])

  const buildContext = (runtimeConfig: AIConfig = aiConfig) => ({
    projectId: project.id!,
    projectName: project.name,
    genre: project.genres?.join('、') || project.genre,
    worldGroupId,
    outlineNodeId,
    chapterId,
    chapterTitle,
    chapterSummary,
    userHint,
    provider: runtimeConfig.provider,
    model: runtimeConfig.model,
    sourceKeys,
    artifacts,
    generate: (messages: ChatMessage[], nodeId: ChapterWorkshopNodeId) => ai.start(
      messages,
      undefined,
      { category: `chapter.workshop.${nodeId}`, projectId: project.id! },
    ),
  })

  const prepareCurrentNode = async () => {
    if (assembling || isBusy) return
    if (currentNode.id === 'alternatives' && selectedModelKeys.length < 2) {
      setLocalError('方案竞选至少需要选择两个已配置模型。')
      return
    }
    setAssembling(true)
    setLocalError(null)
    try {
      const selectedConfigs = selectedModelKeys
        .map(key => availableModels.find(model => model.key === key)?.ref)
        .filter((ref): ref is AIModelRef => Boolean(ref))
        .map(ref => useAIConfigStore.getState().resolveConfigForScene('chapter', ref))
      const smallestContextConfig = selectedConfigs
        .filter(config => (config.contextWindow ?? 0) > 0)
        .sort((left, right) => (left.contextWindow ?? Infinity) - (right.contextWindow ?? Infinity))[0]
      setPendingMessages(await currentNode.assembleInput(buildContext(
        currentNode.id === 'alternatives' ? (smallestContextConfig ?? aiConfig) : aiConfig,
      )))
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '装配本阶段上下文失败')
    } finally {
      setAssembling(false)
    }
  }

  const runCandidateModels = async (messages: ChatMessage[]) => {
    const selected = availableModels.filter(model => selectedModelKeys.includes(model.key))
    if (selected.length < 2) {
      setLocalError('方案竞选至少需要选择两个已配置模型。')
      return
    }
    candidateControllers.current.forEach(controller => controller.abort())
    candidateControllers.current = []
    setCandidateGenerating(true)
    setSelectedCandidateKey(null)
    setDraft('')
    setLocalError(null)
    setCandidateResults(selected.map(model => ({
      key: model.key,
      label: model.label,
      content: '',
    })))

    const finalResults = await Promise.all(selected.map(async model => {
      const controller = new AbortController()
      candidateControllers.current.push(controller)
      const config = useAIConfigStore.getState().resolveConfigForScene('chapter', model.ref)
      let content = ''
      try {
        const stream = streamChat(messages, config, controller.signal, {}, {
          category: 'chapter.workshop.alternatives',
          projectId: project.id!,
        })
        for await (const chunk of stream) {
          if (controller.signal.aborted) break
          content += chunk
          setCandidateResults(current => current.map(item => (
            item.key === model.key ? { ...item, content } : item
          )))
        }
        return { key: model.key, label: model.label, content }
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          return { key: model.key, label: model.label, content: '', error: '已停止' }
        }
        const message = error instanceof Error ? error.message : '模型调用失败'
        setCandidateResults(current => current.map(item => (
          item.key === model.key ? { ...item, error: message } : item
        )))
        return { key: model.key, label: model.label, content, error: message }
      }
    }))

    candidateControllers.current = []
    setCandidateGenerating(false)
    setCandidateResults(finalResults)
    const first = finalResults.find(item => item.content.trim() && !item.error)
    if (first) {
      setSelectedCandidateKey(first.key)
      setDraft(first.content)
    } else {
      setLocalError('所有候选模型均未生成可用方案，请检查模型配置后重试。')
    }
  }

  const runPreparedMessages = async (fields: PromptPreviewField[]) => {
    if (!pendingMessages) return
    const editedMessages = pendingMessages.map((message, index) => ({
      ...message,
      content: fields[index]?.value ?? message.content,
    }))
    setPendingMessages(null)
    if (currentNode.id === 'alternatives') {
      await runCandidateModels(editedMessages)
      return
    }
    setDraft('')
    setLocalError(null)
    ai.reset()
    try {
      const result = await runGenerationNode(currentNode, buildContext(), {
        preparedInput: editedMessages,
      })
      if (result) setDraft(result.output)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '本阶段生成失败')
    }
  }

  const confirmCurrentArtifact = async () => {
    const value = draft.trim()
    if (!value || isBusy || completing) return
    const next: ChapterWorkshopArtifacts = {}
    for (let index = 0; index <= currentIndex; index += 1) {
      const id = CHAPTER_WORKSHOP_NODE_IDS[index]
      const artifact = id === currentNode.id ? value : artifacts[id]
      if (artifact) next[id] = artifact
    }
    setArtifacts(next)

    if (currentIndex < nodes.length - 1) {
      setCurrentIndex(current => current + 1)
      return
    }

    setCompleting(true)
    try {
      await onComplete(value, next)
    } finally {
      setCompleting(false)
    }
  }

  const canVisit = (index: number) => index <= currentIndex
    || Boolean(artifacts[CHAPTER_WORKSHOP_NODE_IDS[index]])

  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-label="正文工坊">
      <div className="flex h-[min(920px,94vh)] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-bg-surface shadow-2xl">
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-text-primary">正文工坊 · {chapterTitle}</h2>
            <p className="mt-1 text-xs text-text-muted">深度模式包含 6 个阶段；方案竞选会并行调用多个模型。中间阶段只供确认和修正，只有“正式正文”会交给右侧 Agent 进入采纳审批。</p>
          </div>
          <button type="button" onClick={onClose} disabled={isBusy || completing} className="rounded p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-40" aria-label="关闭正文工坊">
            <X className="h-4 w-4" />
          </button>
        </header>

        <nav className="grid shrink-0 grid-cols-6 border-b border-border bg-bg-elevated" aria-label="正文工坊阶段">
          {nodes.map((node, index) => {
            const confirmed = Boolean(artifacts[node.id])
            const active = index === currentIndex
            return (
              <button
                type="button"
                key={node.id}
                disabled={!canVisit(index) || isBusy}
                onClick={() => setCurrentIndex(index)}
                className={`min-w-0 border-r border-border px-3 py-3 text-left last:border-r-0 disabled:cursor-not-allowed disabled:opacity-35 ${active ? 'bg-accent/10' : 'hover:bg-bg-hover'}`}
              >
                <span className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${confirmed ? 'bg-success text-white' : active ? 'bg-accent text-white' : 'bg-bg-hover text-text-muted'}`}>
                    {confirmed ? <Check className="h-3 w-3" /> : index + 1}
                  </span>
                  <span className="truncate">{node.label}</span>
                </span>
                <span className="mt-1 block truncate pl-6 text-[10px] text-text-muted">{node.description}</span>
              </button>
            )
          })}
        </nav>

        <main className="flex min-h-0 flex-1 flex-col p-5">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">{currentIndex + 1}. {currentNode.label}</h3>
              <p className="mt-0.5 text-xs text-text-muted">{currentNode.description}</p>
            </div>
            <button
              type="button"
              onClick={() => void prepareCurrentNode()}
              disabled={assembling || isBusy}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs text-accent hover:bg-accent/20 disabled:opacity-40"
            >
              {assembling
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : artifacts[currentNode.id]
                  ? <RotateCcw className="h-3.5 w-3.5" />
                  : <Eye className="h-3.5 w-3.5" />}
              {artifacts[currentNode.id] ? '重跑本阶段' : '预览提示词并生成'}
            </button>
          </div>

          {currentNode.id === 'alternatives' && (
            <div className="mb-3 rounded-md border border-border bg-bg-elevated p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-text-primary">参与竞选的模型</p>
                <span className="text-[11px] text-text-muted">至少选择 2 个，候选会并行生成</span>
              </div>
              <div className="grid max-h-32 grid-cols-2 gap-2 overflow-y-auto pr-1 lg:grid-cols-3">
                {availableModels.map(model => (
                  <label key={model.key} className="flex min-w-0 cursor-pointer items-center gap-2 rounded border border-border bg-bg-base px-2.5 py-2 text-xs text-text-secondary hover:border-accent/50">
                    <input
                      type="checkbox"
                      checked={selectedModelKeys.includes(model.key)}
                      disabled={isBusy}
                      onChange={event => setSelectedModelKeys(current => event.target.checked
                        ? [...current, model.key]
                        : current.filter(key => key !== model.key))}
                      className="accent-accent"
                    />
                    <span className="truncate">{model.label}</span>
                  </label>
                ))}
              </div>
              {availableModels.length < 2 && (
                <p className="mt-2 text-xs text-warning">当前仅配置了一个模型，请先在“设置 → 模型基础配置”中增加模型。</p>
              )}
            </div>
          )}

          {currentNode.id === 'alternatives' && candidateResults.length > 0 && (
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {candidateResults.map(candidate => (
                <button
                  key={candidate.key}
                  type="button"
                  disabled={!candidate.content.trim() || Boolean(candidate.error) || candidateGenerating}
                  onClick={() => {
                    setSelectedCandidateKey(candidate.key)
                    setDraft(candidate.content)
                  }}
                  className={`min-w-[180px] rounded-md border px-3 py-2 text-left text-xs ${selectedCandidateKey === candidate.key ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-bg-base text-text-secondary hover:border-accent/50'} disabled:opacity-45`}
                >
                  <span className="block truncate font-medium">{candidate.label}</span>
                  <span className={`mt-1 block text-[10px] ${candidate.error ? 'text-error' : 'text-text-muted'}`}>
                    {candidate.error || (candidate.content ? `${candidate.content.length} 字符` : '生成中...')}
                  </span>
                </button>
              ))}
            </div>
          )}

          {(localError || ai.error) && (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{localError || ai.error}</span>
            </div>
          )}

          <div className="relative min-h-0 flex-1">
            <textarea
              value={draft}
              onChange={event => setDraft(event.target.value)}
              disabled={isBusy}
              placeholder={isBusy ? 'AI 正在生成本阶段产物...' : '点击“预览提示词并生成”。生成后可在这里编辑，再确认本阶段。'}
              className="h-full min-h-[320px] w-full resize-none rounded-md border border-border bg-bg-base px-4 py-3 text-sm leading-6 text-text-primary outline-none focus:border-accent disabled:opacity-80"
            />
            {isBusy && (
              <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded bg-bg-elevated px-2 py-1 text-xs text-accent shadow">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在生成
              </div>
            )}
          </div>
        </main>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-bg-elevated px-5 py-3">
          <button
            type="button"
            onClick={() => setCurrentIndex(index => Math.max(0, index - 1))}
            disabled={currentIndex === 0 || isBusy}
            className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover disabled:opacity-35"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> 上一阶段
          </button>
          <div className="flex items-center gap-2">
            {isBusy && (
              <button type="button" onClick={() => {
                ai.stop()
                candidateControllers.current.forEach(controller => controller.abort())
                candidateControllers.current = []
                setCandidateGenerating(false)
              }} className="flex items-center gap-1.5 rounded-md bg-error/10 px-3 py-1.5 text-xs text-error hover:bg-error/20">
                <Square className="h-3.5 w-3.5" /> 停止
              </button>
            )}
            <button
              type="button"
              onClick={() => void confirmCurrentArtifact()}
              disabled={!draft.trim() || isBusy || completing || (currentNode.id === 'alternatives' && !selectedCandidateKey)}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-35"
            >
              {completing
                ? '正在提交正式正文...'
                : currentIndex === nodes.length - 1
                  ? '提交 Agent 审批'
                  : '确认本阶段'}
              {currentIndex < nodes.length - 1 && <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </footer>
      </div>

      <PromptPreviewGate
        open={pendingMessages != null}
        title={`${currentNode.label} · 发送前提示词`}
        description="这是当前节点实际发送的 system/user 消息。修改仅影响本次调用，不写回项目设定或提示词库。"
        fields={pendingMessages ? messagesToFields(pendingMessages) : []}
        onCancel={() => setPendingMessages(null)}
        onConfirm={fields => void runPreparedMessages(fields)}
      />
    </div>
  )
}
