import { nanoid } from 'nanoid'
import type { Project, AIModelRef } from '../lib/types'
import type { PromptModuleKey } from '../lib/types/prompt'
import type { AgentChangeProposalCompletionRequirement } from '../lib/agent/runtime/agent-runtime-port'
import type { AgentEvent, ApprovalRequestedAgentEvent } from '../lib/agent/events/agent-events'
import { createAgentPromptProfile } from '../lib/agent/prompts'
import { createProjectAgentRuntime, type ProjectAgentRuntimeResources } from '../lib/agent/runtime/project-agent-runtime'
import { modelRefForCategory } from '../lib/ai/model-scenes'
import { useAIConfigStore } from '../stores/ai-config'
import { usePromptStore } from '../stores/prompt'
import { isStoryForgeDesktopLocation } from '../lib/desktop-runtime'

export type InitializationGroupId = 'worldview' | 'story' | 'characters'
export type InitializationItemStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface ProjectInitializationItem {
  id: string
  stepId: string
  group: InitializationGroupId
  label: string
  status: InitializationItemStatus
  error?: string
}

export interface ProjectInitializationPlan {
  steps: ProjectInitializationStep[]
  items: ProjectInitializationItem[]
}

interface ProjectInitializationStep {
  id: string
  group: InitializationGroupId
  label: string
  itemIds: string[]
  itemLabels: string[]
  promptModuleKey: PromptModuleKey
  instruction: string
  completionRequirement: AgentChangeProposalCompletionRequirement
  expectedCount?: number
}

export interface ProjectInitializationRunnerCallbacks {
  onStepStarted: (step: ProjectInitializationStep) => void
  onStepProgress: (step: ProjectInitializationStep, detail: string) => void
  onStepCompleted: (step: ProjectInitializationStep) => void
  onStepFailed: (step: ProjectInitializationStep, error: string) => void
  onCommit: () => void | Promise<void>
}

interface ProjectInitializationRunnerOptions {
  completedStepIds?: ReadonlySet<string>
}

interface RunnerInput {
  project: Project
  idea: string
  characterCount: number
  worldGroupId: number | null
}

const WORLD_ORIGIN_FIELDS = [
  ['worldOrigin', '世界来源'],
  ['powerHierarchy', '力量体系'],
  ['divineDesign', '神明与信仰'],
] as const

const NATURAL_FIELDS = [
  ['worldStructure', '世界结构'],
  ['worldDimensions', '疆域尺寸'],
  ['continentLayout', '地貌分布'],
  ['mountainsRivers', '山川水系'],
  ['climateByRegion', '气候环境'],
  ['naturalResourceOverview', '自然资源全貌'],
  ['naturalResources', '自然资源分类'],
] as const

const HUMANITY_FIELDS = [
  ['historyLine', '世界历史线'],
  ['worldEvents', '世界大事记'],
  ['races', '种族与民族'],
  ['factionLayout', '势力分布'],
  ['regionDimensions', '城池重镇'],
  ['politicsEconomyCulture', '政治/经济/文化'],
  ['internalConflicts', '矛盾冲突'],
  ['itemDesign', '道具与器物'],
] as const

const STORY_FIELDS = [
  ['logline', '一句话故事'],
  ['concept', '故事概念'],
  ['theme', '故事主题'],
  ['centralConflict', '核心冲突'],
  ['plotPattern', '故事模式'],
  ['mainPlot', '故事主线'],
  ['subPlots', '故事复线'],
] as const

const CHARACTER_REQUIRED_FIELDS = [
  'name', 'roleWeight', 'moralAxis', 'orderAxis', 'shortDescription', 'identity',
  'profile', 'appearance', 'personality', 'motivation', 'background', 'abilities',
  'relationships', 'arc', 'storyRole', 'ending',
] as const

export function createProjectInitializationPlan(input: RunnerInput): ProjectInitializationPlan {
  const steps: ProjectInitializationStep[] = []
  const addStep = (definition: Omit<ProjectInitializationStep, 'itemIds'>) => {
    const itemIds = definition.itemLabels.map((_, index) => `${definition.id}:${index + 1}`)
    steps.push({ ...definition, itemIds })
  }
  const ideaInstruction = manualTextInstruction(input.idea)

  addStep({
    id: 'world-rules', group: 'worldview', label: '建立真实与幻想规则',
    itemLabels: ['真实与幻想规则'], promptModuleKey: 'worldview.dimension',
    instruction: `${ideaInstruction}\n读取设定能力目录后，为预定义的全部世界规则节点建立 entries，并填写 globalNote。每个节点都要明确 historicalAnchors、fictionalAdaptations 和 priority。最终提交 worldRulesProfiles/replace 正式方案。`,
    completionRequirement: proposal('worldRulesProfiles', 'replace', ['entries', 'globalNote'], ['manualText']),
  })
  addWorldviewStep('world-origin', '世界起源与核心设定', WORLD_ORIGIN_FIELDS, ['manualText', 'worldRules'])
  addWorldviewStep('world-natural', '自然环境与地理', NATURAL_FIELDS, ['manualText', 'worldRules', 'worldview'])
  addWorldviewStep('world-humanity', '人文环境与社会', HUMANITY_FIELDS, ['manualText', 'worldRules', 'worldview'])

  const historyCount = 12
  addStep({
    id: 'history-events', group: 'worldview', label: '生成历史事件',
    itemLabels: numberedLabels('历史事件', historyCount), promptModuleKey: 'history.storm', expectedCount: historyCount,
    instruction: `${ideaInstruction}\n读取当前世界观、世界规则和故事核心，生成恰好 ${historyCount} 条按年代递进、能支撑主线的历史事件。最终以 historicalTimelineEvents/add-many 提交，每项包含 era、year、date、title、description、isHistorical，可补充 conceptNote、impact、source、location。`,
    completionRequirement: proposal('historicalTimelineEvents', 'add-many', ['era', 'year', 'date', 'title', 'description', 'isHistorical'], ['manualText', 'worldRules', 'worldview', 'storyCore']),
  })
  addStep({
    id: 'history-keywords', group: 'worldview', label: '生成历史关键词',
    itemLabels: numberedLabels('历史关键词', historyCount), promptModuleKey: 'history.consult', expectedCount: historyCount,
    instruction: `${ideaInstruction}\n读取世界观、世界规则和历史事件，生成恰好 ${historyCount} 条写作时最需要查阅的制度、器物、文化、经济或建筑关键词。最终以 historicalKeywords/add-many 提交，每项包含 keyword、category、era、description；category 只能取 technology、institution、culture、economy、architecture。`,
    completionRequirement: proposal('historicalKeywords', 'add-many', ['keyword', 'category', 'era', 'description'], ['manualText', 'worldRules', 'worldview', 'historical']),
  })
  addStep({
    id: 'world-map', group: 'worldview', label: '生成世界地图配置',
    itemLabels: ['世界地图'], promptModuleKey: 'geography.world-map',
    instruction: `${ideaInstruction}\n读取世界观、世界规则、历史、地点和词条，新增主世界节点及可用的 Voronoi 地图配置。最终以 worldNodes/add 提交，data 包含 parentId:null、name、description、sortOrder:0 和合法 mapConfigJSON。`,
    completionRequirement: proposal('worldNodes', 'add', ['name', 'description', 'sortOrder', 'mapConfigJSON'], ['manualText', 'worldRules', 'worldview', 'historical', 'locations', 'codex']),
  })

  addStep({
    id: 'story-core', group: 'story', label: '生成完整故事设计',
    itemLabels: STORY_FIELDS.map(([, label]) => label), promptModuleKey: 'story.generate',
    instruction: `${ideaInstruction}\n读取已经建立的世界观、世界规则、历史和词条，生成完整且彼此一致的故事设计。最终以 storyCores/replace 提交，必须一次填写 ${STORY_FIELDS.map(([field]) => field).join('、')}。`,
    completionRequirement: proposal('storyCores', 'replace', STORY_FIELDS.map(([field]) => field), ['manualText', 'worldRules', 'worldview', 'historical', 'codex']),
  })

  const batchSize = 4
  for (let start = 0; start < input.characterCount; start += batchSize) {
    const count = Math.min(batchSize, input.characterCount - start)
    const batch = Math.floor(start / batchSize) + 1
    const roleDirection = batch === 1
      ? '核心人物：主角、主要对手和关键伙伴，roleWeight 以 main 为主。'
      : batch % 2 === 0
        ? '重要配角：承担副线、势力冲突和关系张力，roleWeight 以 secondary 为主。'
        : '功能角色：关键 NPC、导师、线人或阶段性对手，roleWeight 以 npc/secondary 为主。'
    addStep({
      id: `characters-${batch}`, group: 'characters', label: `生成角色 ${start + 1}-${start + count}`,
      itemLabels: numberedLabels('角色', count, start + 1), promptModuleKey: 'character.generate', expectedCount: count,
      instruction: `${ideaInstruction}\n读取世界观、世界规则、故事核心、历史、地点、词条和已有角色，新增恰好 ${count} 个互不重复且能推动剧情的角色。${roleDirection}\n最终以 characters/add-many 提交。每个角色必须填写 ${CHARACTER_REQUIRED_FIELDS.join('、')}；roleWeight 使用 main/secondary/npc/extra，moralAxis 使用 good/neutral/evil，orderAxis 使用 lawful/neutral/chaotic。`,
      completionRequirement: proposal('characters', 'add-many', [...CHARACTER_REQUIRED_FIELDS], ['manualText', 'worldRules', 'worldview', 'storyCore', 'historical', 'locations', 'codex', 'characters']),
    })
  }

  const items = steps.flatMap(step => step.itemIds.map((id, index) => ({
    id,
    stepId: step.id,
    group: step.group,
    label: step.itemLabels[index],
    status: 'pending' as const,
  })))
  return { steps, items }

  function addWorldviewStep(
    id: string,
    label: string,
    fields: readonly (readonly [string, string])[],
    sources: string[],
  ) {
    addStep({
      id, group: 'worldview', label, itemLabels: fields.map(([, itemLabel]) => itemLabel),
      promptModuleKey: 'worldview.dimension',
      instruction: `${ideaInstruction}\n读取当前项目事实，生成“${label}”的完整正式设定。最终以 worldviews/replace 提交，必须一次填写 ${fields.map(([field]) => field).join('、')}，不得只给建议或提问。`,
      completionRequirement: proposal('worldviews', 'replace', fields.map(([field]) => field), sources),
    })
  }
}

function numberedLabels(prefix: string, count: number, start = 1): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix} ${String(start + index).padStart(2, '0')}`)
}

function manualTextInstruction(idea: string): string {
  return `故事初始思路如下：\n${idea}\n\n必须先调用 storyforge.context.read 读取 requiredContextSources；读取 manualText 时，把上述故事思路原样作为 manualSourceText。所有结果都应是可直接用于小说创作的正式内容。`
}

function proposal(
  target: string,
  mode: AgentChangeProposalCompletionRequirement['mode'],
  requiredFields: readonly string[],
  requiredContextSources: readonly string[],
): AgentChangeProposalCompletionRequirement {
  return {
    kind: 'change-proposal',
    target,
    mode,
    requiredFields,
    requiredContextSources,
    deliverableKind: 'structured-record',
  }
}

export class ProjectInitializationRunner {
  readonly plan: ProjectInitializationPlan
  readonly #resources: ProjectAgentRuntimeResources
  #currentRunId: string | null = null
  #cancelled = false

  constructor(
    private readonly input: RunnerInput,
    private readonly callbacks: ProjectInitializationRunnerCallbacks,
    private readonly options: ProjectInitializationRunnerOptions = {},
  ) {
    if (!input.project.id) throw new Error('项目尚未保存，无法初始化')
    this.plan = createProjectInitializationPlan(input)
    this.#resources = createProjectAgentRuntime({
      projectId: input.project.id,
      platform: isStoryForgeDesktopLocation() ? 'desktop' : 'web',
      getModelConfig: profile => resolveAgentModelConfig(profile),
      grantedScopes: ['project:read'],
    })
  }

  async run(): Promise<void> {
    try {
      for (const step of remainingInitializationSteps(this.plan.steps, this.options.completedStepIds)) {
        this.assertNotCancelled()
        this.callbacks.onStepStarted(step)
        let lastError: unknown
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await this.runStep(step)
            lastError = undefined
            break
          } catch (error) {
            lastError = error
            if (this.#cancelled || attempt === 2) break
            this.callbacks.onStepProgress(step, `结果不完整，正在重新生成（第 ${attempt + 1} 次）`)
          }
        }
        if (lastError) {
          const message = errorMessage(lastError)
          this.callbacks.onStepFailed(step, message)
          throw lastError
        }
      }
    } finally {
      await this.#resources.storage.close()
    }
  }

  async cancel(): Promise<void> {
    this.#cancelled = true
    if (this.#currentRunId) await this.#resources.runtime.cancel(this.#currentRunId)
  }

  private async runStep(step: ProjectInitializationStep): Promise<void> {
    const projectId = this.input.project.id!
    const conversationId = `initialization-${projectId}-${step.id}-${nanoid(6)}`
    const modelRef = modelForStep(step.promptModuleKey)
    const promptProfile = createAgentPromptProfile(
      usePromptStore.getState().getActive(step.promptModuleKey),
      {
        variables: { instruction: step.instruction, userHint: this.input.idea },
        overrides: { userPromptTemplate: '{{instruction}}' },
      },
    )
    let approval: ApprovalRequestedAgentEvent | undefined
    let runError = ''

    for await (const event of this.#resources.runtime.run({
      conversationId,
      project: { backend: 'dexie', projectId },
      scope: { module: 'project-initialization', worldGroupId: this.input.worldGroupId },
      userMessage: step.instruction,
      completionRequirement: step.completionRequirement,
      promptProfile,
      modelProfile: modelRefKey(modelRef),
    })) {
      this.#currentRunId = event.runId
      this.handleEvent(step, event)
      if (event.type === 'approval.requested') approval = event
      if (event.type === 'run.failed') runError = event.payload.error
      if (event.type === 'run.cancelled') this.#cancelled = true
    }
    this.assertNotCancelled()
    if (runError) throw new Error(runError)
    if (!approval) throw new Error('Agent 没有生成可自动采纳的初始化方案')
    if (step.expectedCount != null) {
      const data = approval.payload.preview?.data
      if (!Array.isArray(data) || data.length !== step.expectedCount) {
        await drain(this.#resources.runtime.resume(approval.runId, {
          approvalId: approval.payload.approvalId,
          decision: 'rejected',
        }))
        throw new Error(`Agent 应生成 ${step.expectedCount} 项，实际生成 ${Array.isArray(data) ? data.length : 0} 项`)
      }
    }

    let committed = false
    let completionRecorded = false
    let retryApproval: ApprovalRequestedAgentEvent | undefined
    for await (const event of this.#resources.runtime.resume(approval.runId, {
      approvalId: approval.payload.approvalId,
      decision: 'approved',
    })) {
      this.handleEvent(step, event)
      if (event.type === 'tool.completed' && event.payload.toolName === 'storyforge.change.commit') {
        committed = true
        if (!completionRecorded) {
          completionRecorded = true
          this.callbacks.onStepCompleted(step)
        }
        await this.callbacks.onCommit()
      }
      if (event.type === 'approval.requested') retryApproval = event
      if (event.type === 'run.failed') runError = event.payload.error
    }
    this.#currentRunId = null
    if (retryApproval) {
      await drain(this.#resources.runtime.resume(retryApproval.runId, {
        approvalId: retryApproval.payload.approvalId,
        decision: 'rejected',
      }))
      throw new Error(retryApproval.payload.summary)
    }
    if (runError) throw new Error(runError)
    if (!committed) throw new Error('初始化方案未能写入项目')
  }

  private handleEvent(step: ProjectInitializationStep, event: AgentEvent) {
    if (event.type === 'phase.started') this.callbacks.onStepProgress(step, event.payload.label)
    if (event.type === 'tool.requested') this.callbacks.onStepProgress(step, event.payload.summary)
    if (event.type === 'reasoning.summary.completed' && event.payload.text.trim()) {
      this.callbacks.onStepProgress(step, event.payload.text.trim().slice(0, 160))
    }
    if (event.type === 'tool.failed') this.callbacks.onStepProgress(step, event.payload.error)
  }

  private assertNotCancelled() {
    if (this.#cancelled) throw new Error('初始化任务已停止')
  }
}

export function remainingInitializationSteps(
  steps: readonly ProjectInitializationStep[],
  completedStepIds: ReadonlySet<string> | undefined,
): ProjectInitializationStep[] {
  if (!completedStepIds?.size) return [...steps]
  return steps.filter(step => !completedStepIds.has(step.id))
}

async function drain(events: AsyncIterable<AgentEvent>): Promise<void> {
  for await (const _event of events) void _event
}

function modelForStep(moduleKey: PromptModuleKey): AIModelRef {
  const state = useAIConfigStore.getState()
  return modelRefForCategory(moduleKey, state.sceneBindings, state.activeModelRef)
}

function resolveAgentModelConfig(profile?: string) {
  const ref = parseModelRefKey(profile)
  const config = useAIConfigStore.getState().resolveConfigForScene('chat', ref ?? undefined)
  return {
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    contextWindow: config.contextWindow,
    compressionThreshold: config.contextCompressionThreshold,
  }
}

function modelRefKey(ref: AIModelRef): string {
  return `${ref.providerConfigId}::${ref.modelId}`
}

function parseModelRefKey(value?: string): AIModelRef | null {
  const [providerConfigId, modelId] = (value || '').split('::')
  return providerConfigId && modelId ? { providerConfigId, modelId } : null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
