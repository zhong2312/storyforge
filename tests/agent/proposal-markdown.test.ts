import { describe, expect, it } from 'vitest'
import {
  proposalApprovalTitle,
  proposalPreviewMarkdown,
} from '../../src/lib/agent/presentation/proposal-markdown'

describe('Agent proposal Markdown', () => {
  it('renders character values with registered labels, groups, and localized enums', () => {
    const preview = {
      target: 'characters',
      mode: 'add',
      data: {
        name: '柳青棠',
        roleWeight: 'secondary',
        moralAxis: 'neutral',
        orderAxis: 'lawful',
        summary: '熟悉桑河一带地方神道的年轻女修。',
        appearance: '常穿洗旧青衫，腰悬木牌。',
        location: '柳青堂',
        personality: '谨慎克制，但不回避危险。',
      },
    } as const

    const markdown = proposalPreviewMarkdown(preview)

    expect(proposalApprovalTitle(preview)).toBe('角色内容已生成，是否采纳？')
    expect(markdown).toContain('## 柳青棠')
    expect(markdown).toContain('### 基本定位')
    expect(markdown).toContain('- **戏份权重**：次要角色')
    expect(markdown).toContain('- **道德倾向**：中立')
    expect(markdown).toContain('- **秩序倾向**：守序')
    expect(markdown).toContain('### 身份')
    expect(markdown).toContain('- **一句话简介**：熟悉桑河一带地方神道的年轻女修。')
    expect(markdown).toContain('- **常驻地点**：柳青堂')
    expect(markdown).toContain('### 性格内核')
    expect(markdown).not.toContain('shortDescription')
    expect(markdown).not.toContain('roleWeight')
  })

  it('uses the chapter-specific approval title without converting prose to a settings list', () => {
    const preview = {
      target: 'chapters', mode: 'replace', recordId: 12,
      data: { content: '山雨压住山门。' },
    } as const

    expect(proposalApprovalTitle(preview)).toBe('正文已生成，是否采纳？')
    expect(proposalPreviewMarkdown(preview)).toBe('')
  })
})
