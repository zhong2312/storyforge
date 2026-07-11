import { describe, expect, it } from 'vitest'
import { modelSceneForCategory } from '../../src/lib/ai/model-scenes'

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
