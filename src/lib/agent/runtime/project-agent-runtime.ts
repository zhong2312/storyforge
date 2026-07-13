import { AdoptionPlanStore, createStoryForgeTools } from '../tools/internal'
import { ToolRegistry } from '../tools/tool-registry'
import type { ToolScope } from '../tools/tool-types'
import { DexieProjectStorage } from '../../storage/adapters/dexie'
import { AiSdkAgentRuntimeAdapter } from './ai-sdk'
import type { AgentModelConfig } from './ai-sdk'

export interface ProjectAgentRuntimeResources {
  readonly runtime: AiSdkAgentRuntimeAdapter
  readonly storage: DexieProjectStorage
  readonly plans: AdoptionPlanStore
}

interface Options {
  projectId: number
  platform: 'web' | 'desktop'
  getModelConfig: (profile?: string) => AgentModelConfig
  grantedScopes?: readonly ToolScope[] | (() => readonly ToolScope[])
  extendRegistry?: (registry: ToolRegistry) => void | Promise<void>
}

/** 右侧 Agent 与后台 Agent 任务共用同一套项目工具、审批计划和存储绑定。 */
export function createProjectAgentRuntime(options: Options): ProjectAgentRuntimeResources {
  const storage = new DexieProjectStorage({ backend: 'dexie', projectId: options.projectId })
  const plans = new AdoptionPlanStore()
  const runtime = new AiSdkAgentRuntimeAdapter({
    platform: options.platform,
    getModelConfig: options.getModelConfig,
    grantedScopes: options.grantedScopes,
    discardPlan: planId => plans.consume(planId),
    createToolRegistry: async () => {
      const registry = new ToolRegistry()
      for (const tool of createStoryForgeTools({ storage, plans })) registry.register(tool)
      await options.extendRegistry?.(registry)
      return registry
    },
  })
  return { runtime, storage, plans }
}
