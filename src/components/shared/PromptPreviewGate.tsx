import { useEffect, useMemo, useState } from 'react'
import { Eye, Send, X } from 'lucide-react'

export interface PromptPreviewField {
  id: string
  label: string
  value: string
  description?: string
}

interface PromptPreviewGateProps {
  open: boolean
  title?: string
  description?: string
  fields: readonly PromptPreviewField[]
  confirmText?: string
  onCancel: () => void
  onConfirm: (fields: PromptPreviewField[]) => void
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2)
}

export default function PromptPreviewGate({
  open,
  title = '发送前提示词预览',
  description = '本次修改只影响当前调用，不会写回提示词库或项目设定。',
  fields,
  confirmText = '使用此提示词生成',
  onCancel,
  onConfirm,
}: PromptPreviewGateProps) {
  const [drafts, setDrafts] = useState<PromptPreviewField[]>(() => fields.map(field => ({ ...field })))

  useEffect(() => {
    if (open) setDrafts(fields.map(field => ({ ...field })))
  }, [fields, open])

  const totalChars = useMemo(() => drafts.reduce((sum, field) => sum + field.value.length, 0), [drafts])
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex h-[min(820px,92vh)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-bg-surface shadow-2xl">
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <Eye className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
            <p className="mt-1 text-xs text-text-muted">{description}</p>
          </div>
          <button type="button" onClick={onCancel} className="rounded p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary" aria-label="关闭提示词预览">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {drafts.map((field, index) => (
            <section key={field.id} className="space-y-1.5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <label htmlFor={`prompt-preview-${field.id}`} className="text-xs font-medium text-text-primary">{field.label}</label>
                  {field.description && <p className="mt-0.5 text-[11px] text-text-muted">{field.description}</p>}
                </div>
                <span className="shrink-0 text-[10px] text-text-muted">{field.value.length.toLocaleString()} 字符 · 约 {estimateTokens(field.value).toLocaleString()} tokens</span>
              </div>
              <textarea
                id={`prompt-preview-${field.id}`}
                value={field.value}
                onChange={event => setDrafts(current => current.map((item, itemIndex) => (
                  itemIndex === index ? { ...item, value: event.target.value } : item
                )))}
                rows={Math.min(14, Math.max(5, Math.ceil(field.value.length / 100)))}
                className="w-full resize-y rounded-md border border-border bg-bg-base px-3 py-2 font-mono text-xs leading-5 text-text-primary outline-none focus:border-accent"
              />
            </section>
          ))}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border bg-bg-elevated px-5 py-3">
          <span className="text-[11px] text-text-muted">合计 {totalChars.toLocaleString()} 字符 · 约 {estimateTokens(drafts.map(field => field.value).join('\n')).toLocaleString()} tokens</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onCancel} className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary">取消</button>
            <button
              type="button"
              onClick={() => onConfirm(drafts.map(field => ({ ...field })))}
              disabled={drafts.some(field => !field.value.trim())}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" /> {confirmText}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
