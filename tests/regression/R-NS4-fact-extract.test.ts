/**
 * R-NS4-fact-extract · AI 事实抽取适配器（NS-4 ①）
 *
 * 守卫不变量：
 * - 谓词归一到受控 key；未登记谓词整条丢弃（不入权威账本）；
 * - 引文必须逐字回查正文，否则整条丢弃（杜绝幻觉证据）；
 * - 产出 factKind 以注册表为准；subject/value 必填。
 */
import { describe, it, expect } from 'vitest'
import { buildFactExtractPrompt, parseFactExtractResult } from '../../src/lib/ai/adapters/fact-extract-adapter'

const chapter = '林飞在洛阳被预言只剩十六年阳寿。他把青铜铃藏进左袖，决定前往北境。'

describe('NS-4 · fact-extract adapter', () => {
  it('prompt 注入受控谓词清单、要求逐字引文', () => {
    const msgs = buildFactExtractPrompt({ chapterTitle: '第一章', chapterContent: chapter })
    const sys = msgs[0].content
    expect(sys).toContain('powerStage')   // 受控谓词清单
    expect(sys).toContain('逐字')          // 引文要求
    expect(msgs[1].content).toContain(chapter)
  })

  it('谓词归一 + 引文回查通过 → 产出规范候选', () => {
    const raw = JSON.stringify({ facts: [
      { subject: '林飞', predicate: '位置', value: '北境', quote: '决定前往北境' }, // alias→location
      { subject: '林飞', predicate: 'powerStage', value: '凡人', quote: '只剩十六年阳寿' },
    ] })
    const out = parseFactExtractResult({ raw, chapterContent: chapter })
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ subjectName: '林飞', predicate: 'location', factKind: 'state', value: '北境' })
    expect(out[1].predicate).toBe('powerStage')
  })

  it('未登记谓词整条丢弃（不入权威账本）', () => {
    const raw = JSON.stringify({ facts: [
      { subject: '林飞', predicate: '心情', value: '绝望', quote: '决定前往北境' }, // 未登记
    ] })
    expect(parseFactExtractResult({ raw, chapterContent: chapter })).toHaveLength(0)
  })

  it('引文未逐字命中正文 → 整条丢弃（杜绝幻觉证据）', () => {
    const raw = JSON.stringify({ facts: [
      { subject: '林飞', predicate: 'location', value: '王城', quote: '林飞登基称王' }, // 正文里没有
    ] })
    expect(parseFactExtractResult({ raw, chapterContent: chapter })).toHaveLength(0)
  })

  it('subject/value 缺失、JSON 损坏 → 安全返回空', () => {
    expect(parseFactExtractResult({ raw: '不是json', chapterContent: chapter })).toEqual([])
    const raw = JSON.stringify({ facts: [{ predicate: 'location', value: '北境', quote: '决定前往北境' }] }) // 缺 subject
    expect(parseFactExtractResult({ raw, chapterContent: chapter })).toHaveLength(0)
  })
})
