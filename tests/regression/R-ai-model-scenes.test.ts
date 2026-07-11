import { describe, expect, it } from 'vitest'
import { modelRefForCategory, modelSceneForCategory } from '../../src/lib/ai/model-scenes'

describe('AI 模型场景路由', () => {
  it.each([
    ['chapter.content', 'chapter'],
    ['chapter.continue', 'chapter'],
    ['chapter.polish', 'polish'],
    ['review.revise', 'polish'],
    ['outline.volume', 'outline'],
    ['detail.scene', 'outline'],
    ['worldview.dimension', 'settings'],
    ['agent.chat', 'chat'],
  ] as const)('%s → %s', (category, expected) => {
    expect(modelSceneForCategory(category)).toBe(expected)
  })
})

it('功能按钮优先使用对应场景绑定，未绑定时回退当前模型', () => {
  const active = { providerConfigId: 'default', modelId: 'chat' }
  const chapter = { providerConfigId: 'writer', modelId: 'novel' }
  expect(modelRefForCategory('chapter.content', { chapter }, active)).toEqual(chapter)
  expect(modelRefForCategory('worldview.dimension', {}, active)).toEqual(active)
})
