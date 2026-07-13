import type { AIModelRef, AIModelScene, AIModelSceneBindings } from '../types'

/** 将现有 module/category key 收口到用户可配置的五类模型场景。 */
export function modelSceneForCategory(category?: string | null): AIModelScene {
  const key = (category || '').toLowerCase()
  if (/book\.edit|polish|revise|rewrite|condense|\.check|de-?ai|anti-?ai|review\.|quality|readability|审校|润色/.test(key)) return 'polish'
  if (/^chapter\.|chapter-|章节正文/.test(key)) return 'chapter'
  if (/outline|detail\.|story-arc|scene/.test(key)) return 'outline'
  if (/agent|chat|对话/.test(key)) return 'chat'
  return 'settings'
}

export function modelRefForCategory(
  category: string | null | undefined,
  bindings: AIModelSceneBindings,
  active: AIModelRef,
): AIModelRef {
  return bindings[modelSceneForCategory(category)] ?? active
}
