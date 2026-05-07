import { useState } from 'react'
import { Square, Check, RotateCcw, Loader2, ThumbsUp, ThumbsDown } from 'lucide-react'
import { usePromptStore } from '../../stores/prompt'
import type { PromptModuleKey, PromptExample } from '../../lib/types/prompt'

interface AIStreamOutputProps {
  /** 流式输出的文本 */
  output: string
  /** 是否正在生成 */
  isStreaming: boolean
  /** 错误信息 */
  error: string | null
  /** 停止生成 */
  onStop: () => void
  /** 采纳内容 */
  onAccept: (text: string) => void
  /** 重试 */
  onRetry: () => void
  /** 占位提示 */
  placeholder?: string
  /** P15：传入则显示「⭐ 好示例 / 💩 坏示例」标记按钮，写入对应模板的 examples */
  moduleKey?: PromptModuleKey
}

/**
 * AI 流式输出展示组件
 * 显示 AI 生成的文字 + 操作按钮（停止/采纳/重试）
 */
export default function AIStreamOutput({
  output,
  isStreaming,
  error,
  onStop,
  onAccept,
  onRetry,
  placeholder = '点击生成按钮，让 AI 为你创作...',
  moduleKey,
}: AIStreamOutputProps) {
  const hasOutput = output.length > 0
  const [marked, setMarked] = useState<'good' | 'bad' | null>(null)

  /** 把当前输出存为模板的好/坏示例 */
  const handleMark = async (kind: 'good' | 'bad') => {
    if (!moduleKey || !output.trim()) return
    const tpl = usePromptStore.getState().getActive(moduleKey)
    const example: PromptExample = {
      id: `ex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: output.trim().slice(0, 2000), // 限制长度
      source: 'user-marked',
      rating: kind === 'good' ? 5 : 1,
      createdAt: Date.now(),
    }
    const examples = tpl.examples || {}
    const updated = {
      ...examples,
      [kind]: [...(examples[kind] || []), example],
    }
    await usePromptStore.getState().saveTemplate({ ...tpl, examples: updated })
    setMarked(kind)
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* 输出区域 */}
      <div className="min-h-[200px] max-h-[500px] overflow-y-auto p-4 bg-bg-surface">
        {error ? (
          <div className="text-error text-sm">
            <p className="font-medium mb-1">⚠️ 生成失败</p>
            <p className="text-text-muted">{error}</p>
          </div>
        ) : hasOutput ? (
          <div className="text-text-primary text-sm leading-relaxed whitespace-pre-wrap">
            {output}
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-accent ml-0.5 animate-pulse" />
            )}
          </div>
        ) : isStreaming ? (
          <div className="flex items-center gap-2 text-text-muted text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>AI 思考中...</span>
          </div>
        ) : (
          <p className="text-text-muted text-sm">{placeholder}</p>
        )}
      </div>

      {/* 操作栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-bg-elevated border-t border-border">
        <span className="text-text-muted text-xs">
          {hasOutput ? `${output.length} 字` : ''}
        </span>
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-error/10 text-error rounded-md hover:bg-error/20 transition-colors"
            >
              <Square className="w-3 h-3" />
              停止
            </button>
          ) : (
            <>
              {(hasOutput || error) && (
                <button
                  onClick={onRetry}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-bg-hover text-text-secondary rounded-md hover:text-text-primary transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  重试
                </button>
              )}
              {/* P15: 标记好/坏示例（仅在已有输出 + moduleKey 提供时） */}
              {hasOutput && !error && moduleKey && (
                <>
                  <button
                    onClick={() => handleMark('good')}
                    disabled={marked === 'good'}
                    title="标为好示例 — 下次生成时 AI 会参考此风格"
                    className={`flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md transition-colors ${
                      marked === 'good'
                        ? 'bg-success/20 text-success'
                        : 'bg-bg-hover text-text-secondary hover:text-success hover:bg-success/10'
                    }`}
                  >
                    <ThumbsUp className="w-3 h-3" />
                    {marked === 'good' ? '已标好' : '好示例'}
                  </button>
                  <button
                    onClick={() => handleMark('bad')}
                    disabled={marked === 'bad'}
                    title="标为坏示例 — 下次生成时 AI 会避开此风格"
                    className={`flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md transition-colors ${
                      marked === 'bad'
                        ? 'bg-error/20 text-error'
                        : 'bg-bg-hover text-text-secondary hover:text-error hover:bg-error/10'
                    }`}
                  >
                    <ThumbsDown className="w-3 h-3" />
                    {marked === 'bad' ? '已标坏' : '反例'}
                  </button>
                </>
              )}
              {hasOutput && !error && (
                <button
                  onClick={() => onAccept(output)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent-hover transition-colors"
                >
                  <Check className="w-3 h-3" />
                  采纳
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
