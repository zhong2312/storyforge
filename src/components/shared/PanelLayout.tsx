import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { PanelLeftClose, PanelLeft } from 'lucide-react'

interface Props {
  /** 侧栏内容 */
  sidebar: ReactNode
  /** 主编辑区内容 */
  children: ReactNode
  /** 侧栏默认宽度 (px) */
  defaultWidth?: number
  /** 侧栏最小宽度 (px) */
  minWidth?: number
  /** 侧栏最大宽度 (px) */
  maxWidth?: number
  /** 侧栏标题（显示在侧栏顶部） */
  sidebarTitle?: string
  /** 额外的 className */
  className?: string
}

/**
 * 通用侧栏+编辑区布局组件
 *
 * - 侧栏宽度可通过拖拽分割线调整
 * - 侧栏可折叠/展开
 * - 拖拽时有视觉反馈
 */
export default function PanelLayout({
  sidebar,
  children,
  defaultWidth = 220,
  minWidth = 160,
  maxWidth = 400,
  sidebarTitle,
  className = '',
}: Props) {
  const [sidebarWidth, setSidebarWidth] = useState(defaultWidth)
  const [collapsed, setCollapsed] = useState(false)
  const [dragging, setDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  useEffect(() => {
    if (!dragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const newWidth = Math.min(maxWidth, Math.max(minWidth, e.clientX - rect.left))
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      setDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging, minWidth, maxWidth])

  return (
    <div ref={containerRef} className={`flex h-full ${className}`}>
      {/* 侧栏 */}
      {!collapsed && (
        <div
          className="shrink-0 flex flex-col border-r border-border bg-bg-surface overflow-hidden"
          style={{ width: sidebarWidth }}
        >
          {/* 侧栏头 */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-elevated">
            {sidebarTitle && (
              <span className="text-xs font-medium text-text-muted truncate">{sidebarTitle}</span>
            )}
            <button
              onClick={() => setCollapsed(true)}
              className="text-text-muted hover:text-text-primary ml-auto"
              title="收起侧栏"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>
          {/* 侧栏内容 */}
          <div className="flex-1 overflow-y-auto">
            {sidebar}
          </div>
        </div>
      )}

      {/* 拖拽分割线 */}
      {!collapsed && (
        <div
          onMouseDown={handleMouseDown}
          className={`w-1 shrink-0 cursor-col-resize transition-colors ${
            dragging ? 'bg-accent' : 'bg-transparent hover:bg-accent/30'
          }`}
        />
      )}

      {/* 主编辑区 */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="fixed z-10 mt-2 ml-2 p-1.5 bg-bg-elevated border border-border rounded-md text-text-muted hover:text-text-primary shadow-sm"
            title="展开侧栏"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}
        {children}
      </div>
    </div>
  )
}
