import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProposalDiffDialog } from '../../src/components/agent/ProposalDiffDialog'
import SceneBindingSection from '../../src/components/settings/SceneBindingSection'

describe('设置与弹窗布局回归', () => {
  it('正文历史给内容网格和正文容器建立完整滚动边界', () => {
    const source = readFileSync('src/components/editor/ChapterHistoryDialog.tsx', 'utf8')
    expect(source).toContain('grid-rows-[auto_minmax(0,1fr)] overflow-hidden')
    expect(source).toContain('flex min-h-0 min-w-0 flex-col overflow-hidden')
    expect(source).toContain('data-testid="chapter-history-scroll-region"')
  })

  it('差异对比为删除和新增使用不同的高对比颜色', () => {
    const markup = renderToStaticMarkup(createElement(ProposalDiffDialog, {
      preview: {
        target: 'chapters',
        mode: 'replace',
        recordId: 1,
        beforeData: { content: '<p>旧正文</p>' },
        data: { content: '<p>新正文</p>' },
      },
      onClose: () => undefined,
    }))
    expect(markup).toContain('bg-red-100 text-red-900')
    expect(markup).toContain('bg-emerald-100 text-emerald-900')
    expect(markup).toContain('aria-label="差异颜色图例"')
    expect(markup).toContain('旧')
    expect(markup).toContain('新')
  })

  it('场景绑定作为模型配置之外的独立设置区域渲染', () => {
    const panel = readFileSync('src/components/settings/AIConfigPanel.tsx', 'utf8')
    const catalog = readFileSync('src/components/settings/ModelCatalogSection.tsx', 'utf8')
    const markup = renderToStaticMarkup(createElement(SceneBindingSection))
    expect(panel).toContain('<SceneBindingSection />')
    expect(catalog).not.toContain('AI_MODEL_SCENES')
    expect(markup).toContain('场景绑定')
    expect(markup).toContain('AI 对话框')
  })
})
