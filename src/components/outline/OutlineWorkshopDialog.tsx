import { useEffect, useMemo, useState } from 'react'
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
import type { AIConfig, ChatMessage, OutlineNode, Project } from '../../lib/types'
import {
  createOutlineWorkshopNodes,
  confirmOutlineWorkshopArtifact,
  runGenerationNode,
  type OutlineWorkshopArtifacts,
  type OutlineWorkshopNodeId,
} from '../../lib/generation-pipeline'
import PromptPreviewGate, { type PromptPreviewField } from '../shared/PromptPreviewGate'
import MarkdownFieldEditor from '../shared/MarkdownFieldEditor'

interface OutlineWorkshopDialogProps {
  project: Project
  volume: OutlineNode
  chapterCount: number
  userHint: string
  aiConfig: AIConfig
  onClose: () => void
  onComplete: (rawOutput: string) => Promise<void> | void
}

function messagesToFields(messages: readonly ChatMessage[]): PromptPreviewField[] {
  return messages.map((message, index) => ({
    id: `${message.role}-${index}`,
    label: message.role === 'system' ? 'System Prompt' : message.role === 'assistant' ? 'Assistant 消息' : 'User Prompt（已拼接项目上下文）',
    value: message.content,
    description: message.role === 'user' ? '这里包含经 CONTEXT_SOURCES 装配的项目设定和已确认阶段产物。' : undefined,
  }))
}

export default function OutlineWorkshopDialog({
  project,
  volume,
  chapterCount,
  userHint,
  aiConfig,
  onClose,
  onComplete,
}: OutlineWorkshopDialogProps) {
  const ai = useAIStream()
  const nodes = useMemo(() => createOutlineWorkshopNodes(), [])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [furthestVisitedIndex, setFurthestVisitedIndex] = useState(0)
  const [artifacts, setArtifacts] = useState<OutlineWorkshopArtifacts>({})
  const [nodeDrafts, setNodeDrafts] = useState<OutlineWorkshopArtifacts>({})
  const [draft, setDraft] = useState('')
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[] | null>(null)
  const [assembling, setAssembling] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const currentNode = nodes[currentIndex]

  useEffect(() => {
    if (!ai.output) return
    setDraft(ai.output)
    setNodeDrafts(current => ({ ...current, [currentNode.id]: ai.output }))
    // 只响应新输出；页签切换时不能把上一节点残留输出写进新节点。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.output])

  useEffect(() => {
    setDraft(nodeDrafts[currentNode.id] ?? artifacts[currentNode.id] ?? '')
    setLocalError(null)
    ai.reset()
    // currentNode.id 是切换阶段的稳定边界；ai.reset 已由 hook memo 化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNode.id])

  const buildContext = () => ({
    projectId: project.id!,
    projectName: project.name,
    genre: project.genres?.join('、') || project.genre,
    worldGroupId: volume.worldGroupId ?? null,
    volumeId: volume.id!,
    volumeTitle: volume.title,
    volumeSummary: volume.summary,
    chapterCount,
    userHint,
    provider: aiConfig.provider,
    model: aiConfig.model,
    artifacts,
    generate: (messages: ChatMessage[], nodeId: OutlineWorkshopNodeId) => ai.start(
      messages,
      undefined,
      { category: `outline.workshop.${nodeId}`, projectId: project.id! },
    ),
  })

  const prepareCurrentNode = async () => {
    if (assembling || ai.isStreaming) return
    setAssembling(true)
    setLocalError(null)
    try {
      const messages = await currentNode.assembleInput(buildContext())
      setPendingMessages(messages)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '装配本阶段上下文失败')
    } finally {
      setAssembling(false)
    }
  }

  const runPreparedMessages = async (fields: PromptPreviewField[]) => {
    if (!pendingMessages) return
    const editedMessages = pendingMessages.map((message, index) => ({
      ...message,
      content: fields[index]?.value ?? message.content,
    }))
    setPendingMessages(null)
    setDraft('')
    setNodeDrafts(current => ({ ...current, [currentNode.id]: '' }))
    setLocalError(null)
    ai.reset()
    try {
      const result = await runGenerationNode(currentNode, buildContext(), { preparedInput: editedMessages })
      if (result) {
        setDraft(result.output)
        setNodeDrafts(current => ({ ...current, [currentNode.id]: result.output }))
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '本阶段生成失败')
    }
  }

  const confirmCurrentArtifact = async () => {
    const value = draft.trim()
    if (!value || ai.isStreaming || completing) return
    const confirmed = confirmOutlineWorkshopArtifact(artifacts, nodeDrafts, currentIndex, value)
    setArtifacts(confirmed.artifacts)
    setNodeDrafts(confirmed.drafts)
    if (currentIndex < nodes.length - 1) {
      setFurthestVisitedIndex(current => confirmed.changed
        ? currentIndex + 1
        : Math.max(current, currentIndex + 1))
      setCurrentIndex(current => current + 1)
    } else {
      setCompleting(true)
      try {
        await onComplete(value)
      } finally {
        setCompleting(false)
      }
    }
  }

  const canVisit = (index: number) => index <= furthestVisitedIndex

  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-label="章纲工坊">
      <div className="flex h-[min(900px,94vh)] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-bg-surface shadow-2xl">
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-text-primary">章纲工坊 · {volume.title}</h2>
            <p className="mt-1 text-xs text-text-muted">深度模式包含 5 次模型调用。每一阶段都先预览提示词，再编辑和确认产物；只有最后的正式章纲会进入采纳流程。</p>
          </div>
          <button type="button" onClick={onClose} disabled={ai.isStreaming || completing} className="rounded p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-40" aria-label="关闭章纲工坊">
            <X className="h-4 w-4" />
          </button>
        </header>

        <nav className="grid shrink-0 grid-cols-5 border-b border-border bg-bg-elevated" aria-label="章纲工坊阶段">
          {nodes.map((node, index) => {
            const confirmed = Boolean(artifacts[node.id])
            const active = index === currentIndex
            return (
              <button
                type="button"
                key={node.id}
                disabled={!canVisit(index) || ai.isStreaming}
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
              disabled={assembling || ai.isStreaming}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs text-accent hover:bg-accent/20 disabled:opacity-40"
            >
              {assembling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : artifacts[currentNode.id] ? <RotateCcw className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {artifacts[currentNode.id] ? '重跑本阶段' : '预览提示词并生成'}
            </button>
          </div>

          {(localError || ai.error) && (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{localError || ai.error}</span>
            </div>
          )}

          <div className="relative flex min-h-0 flex-1 flex-col">
            {ai.isStreaming ? (
              <textarea
                value={draft}
                readOnly
                placeholder="AI 正在生成本阶段产物..."
                className="h-full min-h-[320px] w-full resize-none rounded-md border border-border bg-bg-base px-4 py-3 text-sm leading-6 text-text-primary outline-none opacity-80"
              />
            ) : (
              <MarkdownFieldEditor
                key={currentNode.id}
                value={draft}
                onChange={value => {
                  setDraft(value)
                  setNodeDrafts(current => ({ ...current, [currentNode.id]: value }))
                }}
                label={`${currentNode.label} · Markdown 产物`}
                placeholder="点击“预览提示词并生成”，或在这里直接编写本阶段产物。"
                fill
                live
              />
            )}
            {ai.isStreaming && (
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
            disabled={currentIndex === 0 || ai.isStreaming}
            className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover disabled:opacity-35"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> 上一阶段
          </button>
          <div className="flex items-center gap-2">
            {ai.isStreaming && (
              <button type="button" onClick={ai.stop} className="flex items-center gap-1.5 rounded-md bg-error/10 px-3 py-1.5 text-xs text-error hover:bg-error/20">
                <Square className="h-3.5 w-3.5" /> 停止
              </button>
            )}
            <button
              type="button"
              onClick={() => void confirmCurrentArtifact()}
              disabled={!draft.trim() || ai.isStreaming || completing}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-35"
            >
              {completing ? '正在整理正式章纲...' : currentIndex === nodes.length - 1 ? '进入采纳预览' : '确认本阶段'}
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
