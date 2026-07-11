import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import MarkdownFieldEditor from '../../src/components/shared/MarkdownFieldEditor'
import WorldviewEditorTabs from '../../src/components/shared/WorldviewEditorTabs'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('R-WORLDVIEW-MARKDOWN · 世界观词条优先与限高 Markdown 正文', () => {
  it('默认渲染 Markdown 预览并限制正文区域独立滚动', () => {
    const html = renderToStaticMarkup(
      <MarkdownFieldEditor
        value={'## 修炼层级\n\n| 层级 | 标志 |\n|---|---|\n| 筑基 | 灵台 |'}
        onChange={vi.fn()}
        label="力量体系正文"
      />,
    )

    expect(html).toContain('力量体系正文')
    expect(html).toContain('h-72 min-h-0')
    expect(html).toContain('overflow-y-auto overscroll-contain')
    expect(html).toContain('<h2')
    expect(html).toContain('<table')
    expect(html).toContain('aria-label="编辑 Markdown"')
  })

  it('世界观正文与词条使用页签，正文支持填满剩余高度', () => {
    const tabs = renderToStaticMarkup(
      <WorldviewEditorTabs label="疆域尺寸" body={<div>正文内容</div>} codex={<div>词条内容</div>} />,
    )
    const editor = renderToStaticMarkup(
      <MarkdownFieldEditor value="正文" onChange={vi.fn()} label="疆域尺寸正文" fill />,
    )

    expect(tabs).toContain('role="tablist"')
    expect(tabs).toContain('aria-selected="true"')
    expect(tabs).toContain('正文')
    expect(tabs).toContain('词条')
    expect(tabs).toContain('正文内容')
    expect(tabs).not.toContain('词条内容')
    expect(editor).toContain('flex min-h-80 flex-1 flex-col')
    expect(editor).toContain('min-h-80 flex-1 min-h-0 overflow-y-auto')
  })

  it('世界起源、自然环境和人文环境共用词条优先布局与 Markdown 编辑器', () => {
    const files = [
      'src/components/worldview/WorldviewOriginPanel.tsx',
      'src/components/worldview/WorldviewNaturalPanel.tsx',
      'src/components/worldview/WorldviewHumanityPanel.tsx',
    ]
    for (const file of files) {
      const content = source(file)
      expect(content).toContain('WorldviewCodexSection')
      expect(content).toContain('WorldviewEditorTabs')
      expect(content).toContain('codexContent')
      expect(content).toContain('<MarkdownFieldEditor')
      expect(content).toContain('fill')
    }

    const workspace = source('src/pages/WorkspacePage.tsx')
    expect(workspace).toContain("'worldview-origin'")
    expect(workspace).toContain("'worldview-natural'")
    expect(workspace).toContain("'worldview-humanity'")
    expect(workspace).toContain("'overflow-hidden p-6'")
  })

  it('设定库详细描述和自定义长文本字段使用同一 Markdown 编辑器', () => {
    const codex = source('src/components/codex/CodexPanel.tsx')
    expect(codex).toContain('label="详细描述"')
    expect(codex).toContain('label="Markdown 内容"')
    expect(codex).not.toContain('<CTextarea')
  })
})
