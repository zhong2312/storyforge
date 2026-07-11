import { describe, expect, it } from 'vitest'
import { createAgentPromptProfile } from '../../src/lib/agent/prompts'
import type { PromptTemplate } from '../../src/lib/types/prompt'

describe('Agent prompt profile', () => {
  it('resolves active template parameters while preserving project-context placeholders', () => {
    const profile = createAgentPromptProfile(template(), {
      variables: { userHint: '冲突更强' },
      parameterValues: { tone: '冷峻' },
      overrides: { systemPrompt: '自定义系统提示：{{tone}} / {{projectName}}' },
    })

    expect(profile.moduleKey).toBe('chapter.content')
    expect(profile.systemPrompt).toBe('自定义系统提示：冷峻 / {{projectName}}')
    expect(profile.userPromptTemplate).toContain('要求：冲突更强')
    expect(profile.userPromptTemplate).toContain('正文依据：{{chapterSummary}}')
    expect(profile.parameterValues).toEqual({ tone: '冷峻' })
    expect(profile.goodExamples).toEqual(['认可正文'])
    expect(profile.badExamples).toEqual(['机械正文'])
    expect(profile.modelOverride).toEqual({ temperature: 0.8, maxTokens: 4096 })
  })

  it('uses parameter defaults when the caller has no runtime overrides', () => {
    const profile = createAgentPromptProfile(template())
    expect(profile.systemPrompt).toContain('热血')
    expect(profile.parameterValues).toEqual({ tone: '热血' })
  })
})

function template(): PromptTemplate {
  return {
    id: 1,
    scope: 'user',
    moduleKey: 'chapter.content',
    promptType: 'generate',
    name: '我的正文模板',
    description: 'test',
    systemPrompt: '按{{tone}}风格写作。',
    userPromptTemplate: '{{#if userHint}}要求：{{userHint}}\n{{/if}}正文依据：{{chapterSummary}}',
    variables: ['userHint', 'chapterSummary'],
    parameters: [{
      key: 'tone', label: '基调', type: 'select', options: ['热血', '冷峻'], default: '热血', optional: true,
    }],
    examples: {
      good: [{ id: 'good', text: '认可正文', source: 'user-marked', createdAt: 1 }],
      bad: [{ id: 'bad', text: '机械正文', source: 'user-marked', createdAt: 1 }],
    },
    modelOverride: { temperature: 0.8, maxTokens: 4096 },
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
  }
}
