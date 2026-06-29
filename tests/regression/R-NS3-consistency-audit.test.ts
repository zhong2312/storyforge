import { describe, expect, it } from 'vitest'
import {
  buildConsistencyAuditPrompt,
  parseConsistencyAuditResult,
} from '../../src/lib/ai/adapters/consistency-audit-adapter'

describe('NS-3 · evidence-backed consistency audit', () => {
  const chapter = '林寻说自己从未见过青铜铃，却从左袖取出了青铜铃。'
  const evidence = '【物品流水证据】\n#7 第1章：消耗 青铜铃 ×1（已交给守门人）'

  it('keeps a hard conflict only when both prose quote and evidence quote resolve exactly', () => {
    const result = parseConsistencyAuditResult({
      mode: 'fast',
      chapterContent: chapter,
      evidenceContext: evidence,
      raw: JSON.stringify({
        findings: [{
          category: '持有物',
          severity: 'hard',
          quote: '从左袖取出了青铜铃',
          evidence: [{
            sourceType: 'observation',
            sourceId: 7,
            quote: '消耗 青铜铃 ×1',
          }],
          reason: '该物品此前已消耗',
        }],
      }),
    })
    expect(result?.findings[0]).toMatchObject({
      severity: 'hard',
      category: '持有物',
    })
  })

  it('drops invented prose quotes and downgrades evidence-free hard claims', () => {
    const invented = parseConsistencyAuditResult({
      mode: 'fast',
      chapterContent: chapter,
      evidenceContext: evidence,
      raw: JSON.stringify({
        findings: [{
          category: '地点',
          severity: 'hard',
          quote: '正文里不存在',
          evidence: [],
          reason: '编造',
        }],
      }),
    })
    expect(invented?.findings).toEqual([])

    const noEvidence = parseConsistencyAuditResult({
      mode: 'fast',
      chapterContent: chapter,
      evidenceContext: evidence,
      raw: JSON.stringify({
        findings: [{
          category: '持有物',
          severity: 'hard',
          quote: '从左袖取出了青铜铃',
          evidence: [{ sourceType: 'observation', sourceId: 7, quote: '不存在的证据' }],
          reason: '证据失配',
        }],
      }),
    })
    expect(noEvidence?.findings[0]?.severity).toBe('unknown')
  })

  it('builds distinct fast and deep audit contracts without truncating chapter prose', () => {
    const longChapter = '正文'.repeat(5000)
    const fast = buildConsistencyAuditPrompt({
      mode: 'fast',
      chapterTitle: '测试',
      chapterContent: longChapter,
      evidenceContext: evidence,
    })
    const deep = buildConsistencyAuditPrompt({
      mode: 'deep',
      chapterTitle: '测试',
      chapterContent: longChapter,
      evidenceContext: evidence,
    })
    expect(fast.at(-1)?.content).toContain(longChapter)
    expect(fast[0].content).toContain('低误报')
    expect(deep[0].content).toContain('因果链')
  })
})
