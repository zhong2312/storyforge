import { describe, expect, it } from 'vitest'
import { createProposalDiff } from '../../src/lib/agent/presentation/proposal-diff'

describe('Agent proposal diff', () => {
  it('compares chapter prose as plain text', () => {
    const result = createProposalDiff({
      target: 'chapters',
      mode: 'replace',
      recordId: 1,
      beforeData: { content: '<p>山门外下着小雨。</p>' },
      data: { content: '<p>山门外下着暴雨。</p>' },
    })

    expect(result.beforeText).toBe('山门外下着小雨。')
    expect(result.afterText).toBe('山门外下着暴雨。')
    expect(result.changes.some(change => change.removed && change.value.includes('小'))).toBe(true)
    expect(result.changes.some(change => change.added && change.value.includes('暴'))).toBe(true)
  })

  it('merges a structured patch with existing fields before comparing', () => {
    const result = createProposalDiff({
      target: 'characters',
      mode: 'replace',
      recordId: 2,
      beforeData: { name: '柳青棠', personality: '谨慎', ending: '归隐山林' },
      data: { personality: '谨慎但敢于冒险' },
    })

    expect(result.beforeText).toContain('归隐山林')
    expect(result.afterText).toContain('归隐山林')
    expect(result.beforeText).toContain('谨慎')
    expect(result.afterText).toContain('谨慎但敢于冒险')
    expect(result.changed).toBe(true)
  })

  it('shows an empty baseline for newly added records', () => {
    const result = createProposalDiff({
      target: 'characters',
      mode: 'add',
      data: { name: '新角色', personality: '沉静' },
    })

    expect(result.beforeText).toBe('（无现有内容）')
    expect(result.afterText).toContain('新角色')
  })

  it('does not show unknown fields that adopt will discard', () => {
    const result = createProposalDiff({
      target: 'characters',
      mode: 'replace',
      recordId: 2,
      beforeData: { name: '柳青棠', personality: '谨慎' },
      data: { personality: '果断', imaginaryField: '不会落库' },
    })

    expect(result.afterText).toContain('果断')
    expect(result.afterText).not.toContain('不会落库')
  })

  it('shows every chapter in an add-many proposal', () => {
    const result = createProposalDiff({
      target: 'chapters',
      mode: 'add-many',
      data: [
        { title: '第一章', content: '<p>第一章正文</p>' },
        { title: '第二章', content: '<p>第二章正文</p>' },
      ],
    })

    expect(result.afterText).toContain('【第一章】')
    expect(result.afterText).toContain('第一章正文')
    expect(result.afterText).toContain('【第二章】')
    expect(result.afterText).toContain('第二章正文')
  })
})
