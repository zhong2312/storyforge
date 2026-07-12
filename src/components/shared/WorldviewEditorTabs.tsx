import { useEffect, useState, type ReactNode } from 'react'

type ContentTab = 'body' | 'codex'

export default function WorldviewEditorTabs({
  label,
  body,
  codex,
}: {
  label: string
  body: ReactNode
  codex?: ReactNode
}) {
  const [activeTab, setActiveTab] = useState<ContentTab>('body')
  const hasCodex = Boolean(codex)

  useEffect(() => {
    if (!hasCodex && activeTab === 'codex') setActiveTab('body')
  }, [activeTab, hasCodex])

  if (!hasCodex) {
    return <div className="flex min-h-0 flex-1 flex-col pt-4">{body}</div>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="tablist"
        aria-label={`${label}内容视图`}
        className="flex h-10 shrink-0 items-end gap-6 border-b border-border"
      >
        <TabButton active={activeTab === 'body'} onClick={() => setActiveTab('body')}>
          正文
        </TabButton>
        <TabButton active={activeTab === 'codex'} onClick={() => setActiveTab('codex')}>
          词条
        </TabButton>
      </div>

      <div
        role="tabpanel"
        aria-label={activeTab === 'body' ? `${label}正文` : `${label}词条`}
        className="min-h-0 flex-1 pt-4"
      >
        {activeTab === 'body' ? (
          <div className="flex h-full min-h-0 flex-col">{body}</div>
        ) : (
          <div className="flex h-full min-h-0 flex-col overflow-hidden">{codex}</div>
        )}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative h-10 px-1 text-sm font-medium transition-colors ${
        active ? 'text-accent' : 'text-text-muted hover:text-text-primary'
      }`}
    >
      {children}
      {active && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent" />}
    </button>
  )
}
