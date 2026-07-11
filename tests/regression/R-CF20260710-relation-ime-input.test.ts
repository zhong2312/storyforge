import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/components/relations/CharacterRelationPanel.tsx', 'utf8')

describe('CF-20260710 · 角色关系编辑输入法组合态保护', () => {
  it('关系标签与关系描述使用组合输入安全组件，避免中文 IME 拼音字母落入内容', () => {
    expect(source).toContain("import { CInput, CTextarea } from '../shared/CompositionInput'")
    expect(source).toContain('<CInput')
    expect(source).toContain('<CTextarea')
    expect(source).not.toContain('<textarea\n                    value={rel.description}')
    expect(source).not.toContain('<input\n                    value={rel.label}')
  })
})
