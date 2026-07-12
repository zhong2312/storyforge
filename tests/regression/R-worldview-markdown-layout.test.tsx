import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import MarkdownFieldEditor from '../../src/components/shared/MarkdownFieldEditor'
import WorldviewEditorTabs from '../../src/components/shared/WorldviewEditorTabs'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('R-WORLDVIEW-MARKDOWN · 世界观词条优先与限高 Markdown 正文', () => {
  const containers: HTMLDivElement[] = []

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    containers.splice(0).forEach(container => container.remove())
    document.body.style.overflow = ''
  })

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
    expect(html).toContain('aria-label="放大编辑"')
  })

  it('放大编辑器与原编辑器共享草稿，关闭弹窗时保存', async () => {
    const onChange = vi.fn()
    const container = document.createElement('div')
    containers.push(container)
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<MarkdownFieldEditor value="" onChange={onChange} label="测试正文" />)
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="放大编辑"]')?.click()
    })

    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="测试正文放大编辑"]')
    expect(dialog).toBeTruthy()
    expect(document.body.style.overflow).toBe('hidden')

    const textarea = dialog?.querySelector<HTMLTextAreaElement>('textarea')
    expect(textarea).toBeTruthy()
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, '## 放大后的设定')
      textarea?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      dialog?.querySelector<HTMLButtonElement>('[aria-label="还原编辑器"]')?.click()
    })

    expect(document.querySelector('[role="dialog"][aria-label="测试正文放大编辑"]')).toBeNull()
    expect(onChange).toHaveBeenLastCalledWith('## 放大后的设定')
    await act(async () => root.unmount())
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

  it('嵌入词条区占满页签剩余高度，不使用固定高度', () => {
    const section = source('src/components/shared/WorldviewCodexSection.tsx')
    const tabs = source('src/components/shared/WorldviewEditorTabs.tsx')
    const panel = source('src/components/codex/CodexPanel.tsx')
    expect(tabs).toContain('flex h-full min-h-0 flex-col overflow-hidden')
    expect(section).toContain('flex h-full min-h-0 flex-col gap-3 pb-2')
    expect(section).toContain('min-h-0 flex-1')
    expect(panel).toContain("'flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border'")
    expect(panel).not.toContain('h-[26rem]')
    expect(panel).not.toContain('h-[30rem]')
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

  it('真实与幻想的全部长文本字段使用 Markdown 编辑器', () => {
    const rules = source('src/components/worldview/WorldRulesPanel.tsx')
    expect(rules.match(/<MarkdownFieldEditor/g)).toHaveLength(3)
    expect(rules).toContain('currentEntry.historicalAnchors')
    expect(rules).toContain('currentEntry.fictionalAdaptations')
    expect(rules).toContain('profile.globalNote')
    expect(rules).not.toContain('<textarea')
  })

  it('世界来源接入独立词条分类并显示正文/词条页签', () => {
    const origin = source('src/components/worldview/WorldviewOriginPanel.tsx')
    const humanity = source('src/components/worldview/WorldviewHumanityPanel.tsx')
    const codex = source('src/lib/types/codex.ts')
    expect(origin).toContain("categoryKeys={['originSource', 'originPower', 'originDeity']}")
    expect(origin).toContain("fixedCategoryKeys={['originSource']}")
    expect(origin).toContain('title="世界来源 · 具体词条"')
    expect(codex).toContain("| 'originSource' | 'originPower' | 'originDeity'")
    expect(codex).toContain("builtInKey: 'originSource', name: '世界来源'")
    for (const layoutClass of [
      'flex h-full w-full flex-col space-y-4',
      'flex flex-1 overflow-hidden',
      'min-h-0 min-w-0 flex-1 overflow-hidden p-6',
    ]) {
      expect(origin).toContain(layoutClass)
      expect(humanity).toContain(layoutClass.replace('flex h-full w-full flex-col', 'flex flex-col w-full h-full'))
    }
    expect(origin).not.toContain('max-w-5xl')
  })
})
