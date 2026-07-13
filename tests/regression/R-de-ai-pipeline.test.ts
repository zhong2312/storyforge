import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePromptStore } from '../../src/stores/prompt'
import { buildDeAIRewritePrompt, parseDeAIDiagnosis } from '../../src/lib/ai/de-ai-pipeline/adapter'
import { checkDeAISafety, scanDeAIText } from '../../src/lib/ai/de-ai-pipeline/deterministic-scan'
import { runDeAIPipeline } from '../../src/lib/ai/de-ai-pipeline/run'
import type { PromptTemplate } from '../../src/lib/types/prompt'

afterEach(() => {
  usePromptStore.setState({ templates: [], loaded: false })
})

describe('去 AI 味流水线', () => {
  it('扫描全文，能发现 4000 字之后的问题', () => {
    const text = `${'这是铺垫。'.repeat(900)}\n他不是害怕，而是在衡量退路。`
    expect(text.indexOf('不是')).toBeGreaterThan(4000)

    const report = scanDeAIText(text)
    expect(report.issues.some(issue => issue.category === 'binary-contrast')).toBe(true)
  })

  it('识别二分对照、解释型心理和过度均匀的段落', () => {
    const text = [
      '他感到害怕。',
      '他感到愤怒。',
      '他感到迟疑。',
      '这不是退让，而是等待。',
      '他感到疲惫。',
    ].join('\n')
    const uniformText = Array.from({ length: 6 }, () => '门外传来脚步声。').join('\n')
    const categories = [
      ...scanDeAIText(text).issues,
      ...scanDeAIText(uniformText).issues,
    ].map(issue => issue.category)

    expect(categories).toContain('binary-contrast')
    expect(categories).toContain('explicit-psychology')
    expect(categories).toContain('uniform-rhythm')
  })

  it('重复动作达到阈值才报告，单次正常对话标签不误报', () => {
    const report = scanDeAIText('他深吸一口气，推门进去。\n她深吸一口气，跟在后面。\n“走吧。”他说道。')

    expect(report.issues.some(issue => issue.category === 'repetition')).toBe(true)
    expect(report.issues.some(issue => issue.category === 'dialogue-tag')).toBe(false)
  })

  it('丢弃模型伪造、正文中不存在的 evidence', () => {
    const source = '林砚推开木门，屋里没有灯。'
    const raw = JSON.stringify({
      riskScore: 80,
      summary: '存在问题',
      issues: [
        { category: 'repetition', severity: 'high', evidence: '他仰望璀璨星空', reason: '伪造证据', suggestion: '删除' },
        { category: 'template-wording', severity: 'medium', evidence: '屋里没有灯', reason: '有效证据', suggestion: '核对语境' },
      ],
      integrityRisks: [],
    })
    const result = parseDeAIDiagnosis(raw, source, 20)

    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].evidence).toBe('屋里没有灯')
  })

  it('严格按 detect → rewrite → verify 顺序调用，并把上下文和问题证据送入改写', async () => {
    const stages: string[] = []
    let rewritePrompt = ''
    let verifyPrompt = ''
    const original = '林砚带着3枚铜钱进门。他不是害怕，而是在等门后的人。'
    const rewritten = '林砚揣着3枚铜钱进门。他在等门后的人，脚步并没有慢。'
    const call = vi.fn(async (stage: 'detect' | 'rewrite' | 'verify', messages: { content: string }[]) => {
      stages.push(stage)
      if (stage === 'rewrite') {
        rewritePrompt = messages.map(message => message.content).join('\n')
        return rewritten
      }
      if (stage === 'verify') verifyPrompt = messages.map(message => message.content).join('\n')
      return JSON.stringify({
        riskScore: stage === 'detect' ? 68 : 18,
        summary: '结构诊断',
        issues: stage === 'detect' ? [{
          category: 'binary-contrast', severity: 'high', evidence: '他不是害怕，而是在等门后的人', reason: '二分解释', suggestion: '直接写动作',
        }] : [],
        integrityRisks: [],
      })
    })

    const result = await runDeAIPipeline({
      text: original,
      styleContext: '【作者文风偏好】偏爱短句与冷幽默。',
      strength: 'standard',
      protectedTerms: ['林砚'],
      call,
    })

    expect(stages).toEqual(['detect', 'rewrite', 'verify'])
    expect(rewritePrompt).toContain('偏爱短句与冷幽默')
    expect(rewritePrompt).toContain('他不是害怕，而是在等门后的人')
    expect(rewritePrompt).toContain('林砚')
    expect(verifyPrompt).toContain('改写前原文')
    expect(verifyPrompt).toContain(original)
    expect(verifyPrompt).toContain(rewritten)
    expect(result.blocked).toBe(false)
  })

  it('数字、角色名丢失或篇幅大幅缩水时阻止采纳', () => {
    const original = '林砚在第3天带着12枚铜钱来到渡口。'.repeat(10)
    const safety = checkDeAISafety(original, '他到了渡口。', ['林砚'])

    expect(safety.blocked).toBe(true)
    expect(safety.missingNumbers).toEqual(expect.arrayContaining(['3', '12']))
    expect(safety.missingProtectedTerms).toContain('林砚')
    expect(safety.lengthRatio).toBeLessThan(0.75)
  })

  it('兼容只声明 text 变量的旧 chapter.de-ai 用户模板', () => {
    const now = Date.now()
    const legacyTemplate: PromptTemplate = {
      scope: 'user', moduleKey: 'chapter.de-ai', promptType: 'edit', name: '我的旧模板', description: '',
      systemPrompt: '按旧模板改写。', userPromptTemplate: '旧模板正文：{{text}}', variables: ['text'],
      isActive: true, createdAt: now, updatedAt: now,
    }
    usePromptStore.setState({ templates: [legacyTemplate], loaded: true })
    const scan = scanDeAIText('他不禁停下。')
    const messages = buildDeAIRewritePrompt({
      text: '他不禁停下。',
      styleContext: '作者偏爱克制白描。',
      deterministicReport: scan,
      diagnosedIssues: scan.issues,
      strength: 'light',
      protectedTerms: [],
    })
    const prompt = messages.map(message => message.content).join('\n')

    expect(prompt).toContain('旧模板正文：他不禁停下。')
    expect(prompt).toContain('本次流水线写法合同')
    expect(prompt).toContain('作者偏爱克制白描')
    expect(prompt).toContain('不新增、删除或调换剧情事件')
  })
})
