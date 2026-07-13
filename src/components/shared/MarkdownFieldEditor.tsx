import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  Bold,
  Eye,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Pencil,
  Quote,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import MarkdownContent from './MarkdownContent'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label?: string
  compact?: boolean
  fill?: boolean
  /** 输入时立即同步给父组件，适用于点击外部确认按钮的工作流。 */
  live?: boolean
  headerAction?: ReactNode
}

type EditorMode = 'preview' | 'edit'

export default function MarkdownFieldEditor({
  value,
  onChange,
  placeholder = '输入设定内容，支持 Markdown…',
  label = '设定正文',
  compact = false,
  fill = false,
  live = false,
  headerAction,
}: Props) {
  const [mode, setMode] = useState<EditorMode>(value.trim() ? 'preview' : 'edit')
  const [draft, setDraft] = useState(value)
  const [expanded, setExpanded] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)
  const draftRef = useRef(draft)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  draftRef.current = draft
  valueRef.current = value
  onChangeRef.current = onChange

  useEffect(() => {
    if (composingRef.current || document.activeElement === textareaRef.current) return
    const loadedIntoEmptyEditor = !draft.trim() && value.trim()
    setDraft(value)
    if (loadedIntoEmptyEditor) setMode('preview')
    // Only external value changes should synchronize the local draft/mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const commit = useCallback(() => {
    if (!composingRef.current && draftRef.current !== valueRef.current) {
      onChangeRef.current(draftRef.current)
    }
  }, [])

  const closeExpanded = useCallback(() => {
    commit()
    setExpanded(false)
  }, [commit])

  useEffect(() => {
    if (!expanded) return
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeExpanded()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeExpanded, expanded])

  const changeMode = (next: EditorMode) => {
    if (next === mode) return
    if (next === 'preview') commit()
    setMode(next)
  }

  const applyInline = (before: string, after: string, fallback: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = draft.slice(start, end) || fallback
    const next = `${draft.slice(0, start)}${before}${selected}${after}${draft.slice(end)}`
    setDraft(next)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }

  const applyLinePrefix = (prefix: string, fallback: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const lineStart = draft.lastIndexOf('\n', Math.max(0, start - 1)) + 1
    const selectionEnd = end > start ? end : start
    const lineEndIndex = draft.indexOf('\n', selectionEnd)
    const lineEnd = lineEndIndex === -1 ? draft.length : lineEndIndex
    const block = draft.slice(lineStart, lineEnd) || fallback
    const prefixed = block.split('\n').map(line => `${prefix}${line}`).join('\n')
    setDraft(`${draft.slice(0, lineStart)}${prefixed}${draft.slice(lineEnd)}`)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(lineStart + prefix.length, lineStart + prefixed.length)
    })
  }

  const heightClass = fill ? 'min-h-80 flex-1' : compact ? 'h-48' : 'h-72'

  const renderEditor = (isExpanded: boolean) => (
    <section className={`overflow-hidden rounded-lg border border-border bg-bg-surface ${isExpanded ? 'flex min-h-0 flex-1 flex-col' : fill ? 'flex min-h-80 flex-1 flex-col' : ''}`}>
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border bg-bg-elevated/55 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary">{label}</span>
        <div className="flex shrink-0 items-center gap-1">
          {headerAction}
          <div className="flex rounded-md border border-border bg-bg-base p-0.5" aria-label={`${label}显示模式`}>
            <button
              type="button"
              onClick={() => changeMode('preview')}
              className={`inline-flex h-7 w-8 items-center justify-center rounded transition-colors ${mode === 'preview' ? 'bg-bg-surface text-accent shadow-theme-sm' : 'text-text-muted hover:text-text-primary'}`}
              title="预览 Markdown"
              aria-label="预览 Markdown"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => changeMode('edit')}
              className={`inline-flex h-7 w-8 items-center justify-center rounded transition-colors ${mode === 'edit' ? 'bg-bg-surface text-accent shadow-theme-sm' : 'text-text-muted hover:text-text-primary'}`}
              title="编辑 Markdown"
              aria-label="编辑 Markdown"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={isExpanded ? closeExpanded : () => setExpanded(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
            title={isExpanded ? '还原编辑器' : '放大编辑'}
            aria-label={isExpanded ? '还原编辑器' : '放大编辑'}
          >
            {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {mode === 'edit' && (
        <div className="flex min-h-9 flex-wrap items-center gap-0.5 border-b border-border bg-bg-base px-2 py-1">
          <FormatButton icon={<Heading2 />} label="二级标题" onClick={() => applyLinePrefix('## ', '标题')} />
          <FormatButton icon={<Bold />} label="粗体" onClick={() => applyInline('**', '**', '重点内容')} />
          <FormatButton icon={<Italic />} label="斜体" onClick={() => applyInline('*', '*', '强调内容')} />
          <span className="mx-1 h-4 w-px bg-border" />
          <FormatButton icon={<List />} label="无序列表" onClick={() => applyLinePrefix('- ', '列表项')} />
          <FormatButton icon={<ListOrdered />} label="有序列表" onClick={() => applyLinePrefix('1. ', '列表项')} />
          <FormatButton icon={<Quote />} label="引用" onClick={() => applyLinePrefix('> ', '引用内容')} />
          <FormatButton icon={<Link />} label="链接" onClick={() => applyInline('[', '](https://)', '链接文字')} />
        </div>
      )}

      <div className={`${isExpanded ? 'min-h-0 flex-1' : heightClass} min-h-0 overflow-y-auto overscroll-contain`}>
        {mode === 'preview' ? (
          draft.trim() ? (
            <div
              role="button"
              tabIndex={0}
              onClick={event => {
                if ((event.target as Element).closest('a')) return
                changeMode('edit')
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') changeMode('edit')
              }}
              className="block min-h-full w-full cursor-text px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
              title="点击编辑"
            >
              <MarkdownContent markdown={draft} className="text-sm" />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => changeMode('edit')}
              className="flex h-full w-full items-center justify-center px-4 text-sm text-text-muted"
            >
              {placeholder}
            </button>
          )
        ) : (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={event => {
              const next = event.target.value
              setDraft(next)
              if (live && !composingRef.current) onChangeRef.current(next)
            }}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={event => {
              composingRef.current = false
              const next = event.currentTarget.value
              setDraft(next)
              if (live) onChangeRef.current(next)
            }}
            onBlur={commit}
            onKeyDown={event => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault()
                commit()
              }
            }}
            placeholder={placeholder}
            className="h-full w-full resize-none bg-transparent px-4 py-3 font-mono text-sm leading-6 text-text-primary outline-none placeholder:text-text-muted/55"
          />
        )}
      </div>
    </section>
  )

  return (
    <>
      {renderEditor(false)}
      {expanded && createPortal(
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`${label}放大编辑`}
          onMouseDown={event => {
            if (event.target === event.currentTarget) closeExpanded()
          }}
        >
          <div className="flex h-[min(900px,94vh)] w-full max-w-6xl min-h-0 flex-col">
            {renderEditor(true)}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

function FormatButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactElement<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onMouseDown={event => event.preventDefault()}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
      title={label}
      aria-label={label}
    >
      <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
    </button>
  )
}
