import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compactChapterParagraphs, plainTextToHtml } from '../../src/lib/utils/html'

describe('章节正文段落间距', () => {
  it('纯文本生成正文折叠段间空白行', () => {
    const content = '第一段。\n\n第二段。\n  \n\n第三段。'
    expect(compactChapterParagraphs(content)).toBe('第一段。\n第二段。\n第三段。')
    expect(plainTextToHtml(content)).toBe('<p>第一段。</p><p>第二段。</p><p>第三段。</p>')
  })

  it('HTML 生成正文删除空段落但保留相邻正文段落', () => {
    const content = '<p>第一段。</p><p><br></p><p>&nbsp;</p><p>第二段。</p>'
    expect(compactChapterParagraphs(content)).toBe('<p>第一段。</p><p>第二段。</p>')
  })

  it('正文编辑器默认不增加段后空白', () => {
    const css = readFileSync('src/index.css', 'utf8')
    expect(css).toContain('margin: 0 0 var(--editor-user-paragraph-spacing, 0);')
    expect(css).toContain('p:empty:not(.is-editor-empty)')
    expect(css).toContain('p:has(> br:only-child):not(.is-editor-empty)')
  })
})
