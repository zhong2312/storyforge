/**
 * HTML 与纯文本互转工具
 * 用于 TipTap 富文本 <-> 旧纯文本内容 的双向兼容
 */

/** 判断字符串是否为 HTML（启发式：包含任意 HTML 标签） */
export function isHtml(s: string): boolean {
  if (!s) return false
  return /<\/?[a-z][\s\S]*>/i.test(s)
}

/** 清除章节正文中仅用于 Markdown 排版的段间空行。 */
export function compactChapterParagraphs(content: string): string {
  if (!content) return ''
  if (!isHtml(content)) {
    return content
      .replace(/\r\n?/g, '\n')
      .replace(/\n[\t ]*(?:\n[\t ]*)+/g, '\n')
      .trim()
  }

  return content.replace(
    /<(p|div)(?:\s[^>]*)?>(?:\s|&nbsp;|<br\s*\/?\s*>)*<\/\1>/gi,
    '',
  )
}

/** 纯文本 → HTML：每个非空行包装为一个相邻段落。 */
export function plainTextToHtml(text: string): string {
  if (!text) return ''
  const escape = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  // 兼容 CRLF
  const lines = compactChapterParagraphs(text).split('\n')
  return lines
    .filter(line => line.trim().length > 0)
    .map(line => `<p>${escape(line)}</p>`)
    .join('')
}

/** 将任意内容（可能是 HTML 或纯文本）标准化为 HTML */
export function toHtml(content: string): string {
  if (!content) return ''
  return isHtml(content) ? content : plainTextToHtml(content)
}

/** HTML → 纯文本（剥离标签，段落之间用 \n 分隔） */
export function htmlToPlainText(html: string): string {
  if (!html) return ''
  if (!isHtml(html)) return html
  if (typeof document === 'undefined') {
    // SSR fallback：简单去标签
    return html
      .replace(/<\/(p|div|h[1-6]|li|blockquote|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  // 将块级元素转为换行
  const blocks = tmp.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,br')
  blocks.forEach(el => {
    if (el.tagName === 'BR') {
      el.replaceWith('\n')
    } else {
      el.append('\n')
    }
  })
  return (tmp.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

/** 统计字数（中文按字符数、英文按单词拆分再合计） */
export function countWords(plainText: string): number {
  if (!plainText) return 0
  // 简化处理：直接返回非空白字符数（与旧实现一致）
  return plainText.replace(/\s/g, '').length
}
