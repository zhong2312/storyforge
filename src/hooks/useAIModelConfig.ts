import { useMemo } from 'react'
import type { AIModelScene } from '../lib/types'
import { resolveAIModelConfig, useAIConfigStore } from '../stores/ai-config'

/** 订阅模型目录与场景绑定，并返回该场景当前的稳定运行时配置。 */
export function useAIModelConfig(scene: AIModelScene) {
  const providers = useAIConfigStore(state => state.providerConfigs)
  const bindings = useAIConfigStore(state => state.sceneBindings)
  const active = useAIConfigStore(state => state.activeModelRef)
  return useMemo(
    () => resolveAIModelConfig(providers, bindings, active, scene),
    [scene, providers, bindings, active],
  )
}
