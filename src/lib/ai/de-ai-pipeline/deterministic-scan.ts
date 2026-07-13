import type {
  DeAIIssue,
  DeAIIssueCategory,
  DeAIIssueSeverity,
  DeAISafetyCheck,
  DeterministicScanReport,
} from './types'

interface PatternRule {
  category: DeAIIssueCategory
  severity: DeAIIssueSeverity
  regex: RegExp
  reason: string
  suggestion: string
  minCount?: number
}

const PATTERN_RULES: PatternRule[] = [
  {
    category: 'template-wording', severity: 'medium',
    regex: /不禁|不由得|缓缓(?:地)?|微微(?:一|地)?|一丝(?:不易察觉的)?|心中一(?:震|动|紧)|嘴角(?:微微)?(?:上扬|勾起)|眼中闪过/g,
    reason: '出现高频模板化措辞，容易让叙述显得可替换。', suggestion: '改成角色此刻独有的动作、感官或反应。',
  },
  {
    category: 'explicit-psychology', severity: 'medium',
    regex: /(?:他|她|我|其)(?:感到|意识到|明白|知道|觉得|内心充满|心里涌起)[^。！？\n]{0,28}/g,
    reason: '直接解释人物心理，压过了可观察的行为证据。', suggestion: '只保留情节必需的心理，其余用动作、停顿或措辞承载。',
  },
  {
    category: 'binary-contrast', severity: 'high',
    regex: /不是[^。！？\n]{1,36}而是[^。！？\n]{1,36}|与其说[^。！？\n]{1,36}不如说[^。！？\n]{1,36}/g,
    reason: '二分对照句带有明显的解释和总结腔。', suggestion: '直接落在更准确的那个动作或判断上。',
  },
  {
    category: 'signposting', severity: 'medium',
    regex: /首先|其次|再次|最后|总而言之|综上所述|值得注意的是|需要指出的是|换句话说|由此可见/g,
    reason: '论文式路标词打断小说叙事。', suggestion: '删除路标，让事件、动作或视角自然衔接。',
  },
  {
    category: 'generic-comfort', severity: 'medium',
    regex: /没关系[^。！？\n]{0,20}(?:都会|会好起来|有我在)|无论如何[^。！？\n]{0,28}(?:陪着你|支持你)|一切都会好起来/g,
    reason: '安抚台词过于通用，缺少人物关系和现场压力。', suggestion: '让台词带上角色的利益、习惯、回避或口是心非。',
  },
  {
    category: 'mechanical-transition', severity: 'low',
    regex: /与此同时|就在这时|话音刚落|紧接着|随即|片刻之后|不多时/g,
    reason: '机械转场词集中出现，节奏容易呈流水账。', suggestion: '用新动作、声音或视角落点完成转场。',
    minCount: 3,
  },
  {
    category: 'dialogue-tag', severity: 'low',
    regex: /(?:说道|答道|问道|笑道|冷声道|沉声道|低声道)/g,
    reason: '对话标签可能同质化。', suggestion: '能从上下文辨认说话人时删标签，必要时换成有效动作。',
    minCount: 4,
  },
  {
    category: 'repetition', severity: 'medium',
    regex: /点了点头|摇了摇头|深吸一口气|攥紧(?:了)?拳头|抿了抿唇|皱了皱眉|挑了挑眉|沉默(?:了)?片刻|(?:目光|视线)落在/g,
    reason: '相同的通用动作反复承担人物反应。', suggestion: '保留最有效的一次，其余改成符合当下物理环境和人物习惯的反应。',
    minCount: 2,
  },
  {
    category: 'format', severity: 'high',
    regex: /[\u200B-\u200D\u2060\uFEFF]|\u00A0/g,
    reason: '正文含零宽字符或特殊空格。', suggestion: '清理不可见字符，保留正常段落和标点。',
  },
]

function variation(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  if (mean === 0) return 0
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) / mean
}

function evidenceWithContext(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 18)
  const end = Math.min(text.length, index + length + 18)
  return text.slice(start, end).replace(/\s+/g, ' ').trim()
}

function pushPatternIssues(text: string, issues: DeAIIssue[]): void {
  for (const rule of PATTERN_RULES) {
    const matches = [...text.matchAll(rule.regex)]
    if (matches.length < (rule.minCount ?? 1)) continue
    const first = matches[0]
    issues.push({
      id: `det-${rule.category}-${issues.length + 1}`,
      source: 'deterministic',
      category: rule.category,
      severity: matches.length >= 4 && rule.severity === 'low' ? 'medium' : rule.severity,
      evidence: evidenceWithContext(text, first.index ?? 0, first[0].length),
      reason: rule.reason,
      suggestion: rule.suggestion,
      count: matches.length,
    })
  }
}

function pushStructuralIssues(paragraphs: string[], sentences: string[], issues: DeAIIssue[]): void {
  const paragraphVariation = variation(paragraphs.map(p => p.length))
  if (paragraphs.length >= 5 && paragraphVariation < 0.22) {
    issues.push({
      id: `det-uniform-paragraphs-${issues.length + 1}`, source: 'deterministic', category: 'uniform-rhythm', severity: 'high',
      evidence: paragraphs.slice(0, 3).map(p => p.slice(0, 30)).join(' / '),
      reason: '连续段落长度过度均匀，呈现机械排布。', suggestion: '按场景压力和信息量重新断段，不要为了整齐维持同一长度。',
    })
  }

  const sentenceVariation = variation(sentences.map(s => s.length))
  if (sentences.length >= 8 && sentenceVariation < 0.28) {
    issues.push({
      id: `det-uniform-sentences-${issues.length + 1}`, source: 'deterministic', category: 'uniform-rhythm', severity: 'medium',
      evidence: sentences.slice(0, 4).join(''), reason: '句长变化不足，叙述速度近乎恒定。',
      suggestion: '在动作落点、犹豫和冲突处改变句长，而不是随机切碎句子。',
    })
  }

  const openings = new Map<string, { count: number; evidence: string }>()
  for (const sentence of sentences) {
    const clean = sentence.replace(/^[“”'"\s]+/, '')
    const opening = clean.slice(0, Math.min(4, clean.length))
    if (opening.length < 2) continue
    const current = openings.get(opening)
    openings.set(opening, { count: (current?.count ?? 0) + 1, evidence: current?.evidence ?? clean.slice(0, 36) })
  }
  const repeatedOpening = [...openings.entries()].sort((a, b) => b[1].count - a[1].count)[0]
  if (repeatedOpening && repeatedOpening[1].count >= 3) {
    issues.push({
      id: `det-opening-${issues.length + 1}`, source: 'deterministic', category: 'repeated-opening', severity: 'medium',
      evidence: repeatedOpening[1].evidence, count: repeatedOpening[1].count,
      reason: `至少 ${repeatedOpening[1].count} 句以“${repeatedOpening[0]}”起笔。`, suggestion: '删除多余主语或让句子从动作结果、声音、物件切入。',
    })
  }

  const endingSummary = paragraphs.filter(p => /(?:这一刻|直到此刻|他终于明白|她终于明白|这才是|也许这就是|命运|新的开始)[^。！？]{0,30}[。！？]?$/.test(p))
  if (endingSummary.length) {
    issues.push({
      id: `det-summary-${issues.length + 1}`, source: 'deterministic', category: 'over-summary', severity: 'medium',
      evidence: endingSummary[0].slice(-80), count: endingSummary.length,
      reason: '段尾用抽象判断替读者总结了情绪或主题。', suggestion: '停在具体动作、物件或未说完的话上。',
    })
  }
}

export function scanDeAIText(text: string): DeterministicScanReport {
  const paragraphs = text.split(/\r?\n+/).map(p => p.trim()).filter(Boolean)
  const sentences = (text.match(/[^。！？!?\n]+[。！？!?]?/g) ?? []).map(s => s.trim()).filter(Boolean)
  const issues: DeAIIssue[] = []
  pushPatternIssues(text, issues)
  pushStructuralIssues(paragraphs, sentences, issues)

  const severityWeight: Record<DeAIIssueSeverity, number> = { low: 5, medium: 10, high: 18 }
  const weighted = issues.reduce((sum, issue) => sum + severityWeight[issue.severity] + Math.min(8, (issue.count ?? 1) - 1), 0)
  const densityBoost = text.length ? Math.min(20, Math.round((issues.length * 1600) / text.length)) : 0

  return {
    riskScore: Math.min(100, weighted + densityBoost),
    issues,
    stats: {
      characters: text.length,
      paragraphs: paragraphs.length,
      sentences: sentences.length,
      dialogueMarks: (text.match(/[“”「」『』"]/g) ?? []).length,
      sentenceLengthVariation: Number(variation(sentences.map(s => s.length)).toFixed(2)),
      paragraphLengthVariation: Number(variation(paragraphs.map(p => p.length)).toFixed(2)),
    },
  }
}

function uniqueMatches(text: string, regex: RegExp): string[] {
  return [...new Set(text.match(regex) ?? [])]
}

export function checkDeAISafety(original: string, rewritten: string, protectedTerms: string[] = []): DeAISafetyCheck {
  const originalLength = Math.max(1, original.trim().length)
  const rewrittenLength = rewritten.trim().length
  const lengthRatio = rewrittenLength / originalLength
  const originalNumbers = uniqueMatches(original, /\d+(?:[.,]\d+)*(?:%|％)?/g)
  const missingNumbers = originalNumbers.filter(value => !rewritten.includes(value))
  const requiredTerms = [...new Set(protectedTerms.map(term => term.trim()).filter(term => term && original.includes(term)))]
  const missingProtectedTerms = requiredTerms.filter(term => !rewritten.includes(term))
  const originalParagraphs = Math.max(1, original.split(/\r?\n+/).filter(p => p.trim()).length)
  const rewrittenParagraphs = rewritten.split(/\r?\n+/).filter(p => p.trim()).length
  const paragraphRatio = rewrittenParagraphs / originalParagraphs
  const originalDialogueMarks = (original.match(/[“”「」『』"]/g) ?? []).length
  const rewrittenDialogueMarks = (rewritten.match(/[“”「」『』"]/g) ?? []).length
  const dialogueMarkRatio = originalDialogueMarks ? rewrittenDialogueMarks / originalDialogueMarks : 1
  const warnings: string[] = []

  if (!rewritten.trim()) warnings.push('模型没有返回可用正文。')
  if (lengthRatio < 0.75 || lengthRatio > 1.25) warnings.push(`改写篇幅为原文的 ${Math.round(lengthRatio * 100)}%，超出 75%–125% 安全范围。`)
  if (missingNumbers.length) warnings.push(`原文数字缺失：${missingNumbers.slice(0, 8).join('、')}`)
  if (missingProtectedTerms.length) warnings.push(`正文中的受保护名称缺失：${missingProtectedTerms.slice(0, 8).join('、')}`)
  if (originalParagraphs >= 4 && paragraphRatio < 0.55) warnings.push('段落数量大幅减少，可能合并或删掉了场景内容。')
  if (originalDialogueMarks >= 4 && (dialogueMarkRatio < 0.5 || dialogueMarkRatio > 1.75)) warnings.push('对话引号数量变化异常，可能损坏了对白结构。')

  return {
    blocked: warnings.length > 0,
    warnings,
    lengthRatio: Number(lengthRatio.toFixed(2)),
    missingNumbers,
    missingProtectedTerms,
    paragraphRatio: Number(paragraphRatio.toFixed(2)),
    dialogueMarkRatio: Number(dialogueMarkRatio.toFixed(2)),
  }
}
