import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import MarkdownContent from '../../src/components/shared/MarkdownContent'

describe('MarkdownContent', () => {
  it('renders GFM Markdown instead of exposing source markers', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent markdown={'**阵容分析**\n\n- 地方神道\n- 水府旧约'} />,
    )

    expect(html).toContain('<strong')
    expect(html).toContain('<ul')
    expect(html).not.toContain('**阵容分析**')
  })

  it('does not render raw HTML supplied by the model', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent markdown={'<script>alert("x")</script>\n\n正常内容'} />,
    )

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
