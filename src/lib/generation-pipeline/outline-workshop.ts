import type { AIProvider, ChatMessage } from '../types'
import { assembleContext } from '../registry/assemble-context'
import type { AssembleContextInput, AssembleContextResult } from '../registry/types'
import type { GenerationNode } from './types'

export const OUTLINE_WORKSHOP_NODE_IDS = [
  'scan',
  'motivation',
  'collision',
  'quality',
  'scene-cards',
] as const

export type OutlineWorkshopNodeId = typeof OUTLINE_WORKSHOP_NODE_IDS[number]
export type OutlineWorkshopArtifacts = Partial<Record<OutlineWorkshopNodeId, string>>

export interface ConfirmOutlineWorkshopArtifactResult {
  artifacts: OutlineWorkshopArtifacts
  drafts: OutlineWorkshopArtifacts
  changed: boolean
}

/**
 * 回看阶段不应破坏后续结果。只有重新确认的内容发生变化时，才清除依赖该
 * 阶段的后续产物和草稿，避免旧推演继续参与上下文装配。
 */
export function confirmOutlineWorkshopArtifact(
  artifacts: OutlineWorkshopArtifacts,
  drafts: OutlineWorkshopArtifacts,
  currentIndex: number,
  value: string,
): ConfirmOutlineWorkshopArtifactResult {
  const currentId = OUTLINE_WORKSHOP_NODE_IDS[currentIndex]
  const normalized = value.trim()
  const changed = (artifacts[currentId] ?? '').trim() !== normalized
  const nextArtifacts: OutlineWorkshopArtifacts = changed ? {} : { ...artifacts }
  const nextDrafts: OutlineWorkshopArtifacts = changed ? {} : { ...drafts }
  const lastIndex = changed ? currentIndex : OUTLINE_WORKSHOP_NODE_IDS.length - 1

  for (let index = 0; index <= lastIndex; index += 1) {
    const id = OUTLINE_WORKSHOP_NODE_IDS[index]
    const artifact = id === currentId ? normalized : artifacts[id]
    const draft = id === currentId ? normalized : drafts[id]
    if (artifact) nextArtifacts[id] = artifact
    if (draft) nextDrafts[id] = draft
  }
  return { artifacts: nextArtifacts, drafts: nextDrafts, changed }
}

export interface OutlineWorkshopContext {
  projectId: number
  projectName: string
  genre: string
  worldGroupId: number | null
  volumeId: number
  volumeTitle: string
  volumeSummary: string
  chapterCount: number
  userHint: string
  provider: AIProvider
  model: string
  artifacts: OutlineWorkshopArtifacts
  generate: (messages: ChatMessage[], nodeId: OutlineWorkshopNodeId) => Promise<string>
  assemble?: (input: AssembleContextInput) => Promise<AssembleContextResult>
}

export type OutlineWorkshopNode = GenerationNode<OutlineWorkshopContext, ChatMessage[], string> & {
  id: OutlineWorkshopNodeId
  prerequisiteIds: readonly OutlineWorkshopNodeId[]
}

const BASE_SOURCE_KEYS = [
  'worldview',
  'storyCore',
  'powerSystem',
  'codex',
  'characters',
  'creativeRules',
  'worldRules',
  'historical',
  'locations',
  'existingVolumeOutlines',
  'foreshadows',
  'storyArcs',
  'emotionBeats',
  'stateCards',
  'itemLedger',
  'storyTimeline',
  'characterRelations',
] as const

const NODE_META: Record<OutlineWorkshopNodeId, {
  label: string
  description: string
  prerequisiteIds: readonly OutlineWorkshopNodeId[]
  task: string
}> = {
  scan: {
    label: '现状扫描',
    description: '盘点当前卷必须推进的事实、角色、伏笔与风险。',
    prerequisiteIds: [],
    task: `先做创作现状扫描，不要直接写章纲。请输出 Markdown，至少包含：
1. 本卷必须推进的主线事实与阶段目标；
2. 应出场角色及其当前状态、已知信息和未知信息；
3. 应推进或回收的伏笔、故事线和情绪节拍；
4. 时间、地点、物品、力量与世界规则约束；
5. 最容易出现的连续性风险。
所有判断必须能在提供的项目上下文中找到依据；依据不足时明确标注“待作者决定”。`,
  },
  motivation: {
    label: '动机推演',
    description: '从角色欲望、恐惧和认知边界推导行动倾向。',
    prerequisiteIds: ['scan'],
    task: `基于已确认的现状扫描推演关键角色动机，不要直接写章纲。请用 Markdown 表格逐个给出：
- 此刻最想得到什么；
- 最害怕失去什么；
- 已知、不知道、误以为的事情；
- 会主动采取的行动；
- 不会采取的越界行动；
- 动机变化的触发条件。
行动必须来自人物动机、性格与认知边界，禁止为了推进剧情让角色突然降智或开天眼。`,
  },
  collision: {
    label: '碰撞预演',
    description: '让角色动机相撞，形成反应链和不可逆结果。',
    prerequisiteIds: ['scan', 'motivation'],
    task: `基于已确认的扫描和动机推演设计本卷的剧情碰撞。请输出 Markdown，给出若干候选碰撞链。每条必须包含：
1. 参与者与互相冲突的目标；
2. 至少三步“行动 → 理解/误解 → 反应”的因果链；
3. 付出的代价与不可逆结果；
4. 对主线、伏笔和人物关系的推进；
5. 可形成的章末钩子。
优先使用价值错位和有限信息造成的冲突，禁止只靠巧合、外力空降或无代价胜利推进。`,
  },
  quality: {
    label: '质检闸门',
    description: '对方案做反套路和连续性软审查，列出返工要求。',
    prerequisiteIds: ['scan', 'motivation', 'collision'],
    task: `审查已确认的碰撞预演。本阶段是 LLM 软审查建议，不得把推测伪装成确定性校验。请逐项检查：
- 反派降智、主角开天眼、巧合推进、轻易胜利；
- 强行冲突、信息差滥用、角色工具人化、其他人物与世界时间冻结；
- 主线偏离、伏笔遗忘、认知越界、物品或能力凭空出现；
- 节奏重复、连续多章无不可逆变化、章末钩子同质化。
输出 Markdown，分为“通过项”“风险项”“必须返工项”“明确修改建议”。没有项目证据时标为待核对，不得宣称硬性通过。`,
  },
  'scene-cards': {
    label: '正式章纲',
    description: '吸收质检意见，生成可采纳的结构化章节章纲。',
    prerequisiteIds: ['scan', 'motivation', 'collision', 'quality'],
    task: `吸收前四阶段已确认产物和质检修改建议，为当前卷生成正式章节章纲。
只输出合法 JSON 数组，不要 Markdown 代码围栏，不要解释。数组元素严格使用：
{"title":"第1章 标题","summary":"本章推进作用；主要场景；在场角色及动机；核心冲突与至少三步反应链；付出代价和不可逆结果；伏笔/主线推进；结尾衔接或钩子；不可写清单"}
必须恰好生成指定章节数；每章都要推进本卷主线，前后因果连续；summary 必须是可直接采纳的正式章纲，不得写成提问、讨论方案或空泛建议。`,
  },
}

function confirmedArtifactsText(
  artifacts: OutlineWorkshopArtifacts,
  requiredIds: readonly OutlineWorkshopNodeId[],
): string {
  const missing = requiredIds.filter(id => !artifacts[id]?.trim())
  if (missing.length > 0) {
    const labels = missing.map(id => NODE_META[id].label).join('、')
    throw new Error(`请先确认前序阶段：${labels}`)
  }
  return requiredIds
    .map(id => `## 已确认阶段：${NODE_META[id].label}\n${artifacts[id]!.trim()}`)
    .join('\n\n')
}

async function assembleNodeMessages(
  nodeId: OutlineWorkshopNodeId,
  context: OutlineWorkshopContext,
): Promise<ChatMessage[]> {
  const meta = NODE_META[nodeId]
  const artifactText = confirmedArtifactsText(context.artifacts, meta.prerequisiteIds)
  const assemble = context.assemble ?? assembleContext
  const assembled = await assemble({
    projectId: context.projectId,
    worldGroupId: context.worldGroupId,
    outlineNodeId: context.volumeId,
    provider: context.provider,
    model: context.model,
    sourceKeys: [
      ...BASE_SOURCE_KEYS,
      ...(artifactText ? ['manualText'] : []),
    ],
    manualSourceText: artifactText,
  })

  const userConstraint = context.userHint.trim()
    ? `\n\n【作者本次要求】\n${context.userHint.trim()}`
    : ''
  return [
    {
      role: 'system',
      content: `你是 StoryForge 章纲工坊的“${meta.label}”节点。你只完成当前节点任务，不越级生成后续内容。所有结论必须服从项目 Canon、世界规则、角色认知和已确认的前序阶段。使用简体中文。`,
    },
    {
      role: 'user',
      content: `【项目】${context.projectName}\n【类型】${context.genre || '未指定'}\n【当前卷】${context.volumeTitle}\n【卷纲】${context.volumeSummary || '（尚未填写）'}\n【目标章节数】${context.chapterCount}\n\n【经 CONTEXT_SOURCES 装配的项目上下文】\n${assembled.text || '（暂无可用上下文）'}\n\n【当前阶段任务】\n${meta.task}${userConstraint}`,
    },
  ]
}

export function createOutlineWorkshopNodes(): OutlineWorkshopNode[] {
  return OUTLINE_WORKSHOP_NODE_IDS.map(id => {
    const meta = NODE_META[id]
    return {
      id,
      label: meta.label,
      description: meta.description,
      prerequisiteIds: meta.prerequisiteIds,
      editableInput: true,
      assembleInput: context => assembleNodeMessages(id, context),
      run: (input, context) => context.generate(input, id),
    }
  })
}

export function getOutlineWorkshopNodeMeta(id: OutlineWorkshopNodeId) {
  return NODE_META[id]
}
