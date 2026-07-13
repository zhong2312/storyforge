import { assembleContext } from '../registry/assemble-context'
import type { AssembleContextResult } from '../registry/types'
import type { AIProvider, ChatMessage } from '../types'
import type { GenerationNode } from './types'

export const CHAPTER_WORKSHOP_NODE_IDS = [
  'constraints',
  'alternatives',
  'beats',
  'draft',
  'review',
  'final',
] as const

export type ChapterWorkshopNodeId = typeof CHAPTER_WORKSHOP_NODE_IDS[number]
export type ChapterWorkshopArtifacts = Partial<Record<ChapterWorkshopNodeId, string>>

export interface ChapterWorkshopContext {
  projectId: number
  projectName: string
  genre: string
  worldGroupId: number | null
  outlineNodeId: number
  chapterId: number
  chapterTitle: string
  chapterSummary: string
  userHint: string
  provider: AIProvider
  model: string
  sourceKeys: string[]
  artifacts: ChapterWorkshopArtifacts
  generate: (messages: ChatMessage[], nodeId: ChapterWorkshopNodeId) => Promise<string>
  assemble?: (input: Parameters<typeof assembleContext>[0]) => Promise<AssembleContextResult>
}

export type ChapterWorkshopNode = GenerationNode<ChapterWorkshopContext, ChatMessage[], string> & {
  id: ChapterWorkshopNodeId
  prerequisiteIds: readonly ChapterWorkshopNodeId[]
}

const NODE_META: Record<ChapterWorkshopNodeId, {
  label: string
  description: string
  prerequisiteIds: readonly ChapterWorkshopNodeId[]
  task: string
}> = {
  constraints: {
    label: '约束扫描',
    description: '核对设定、连续性、角色认知和不可写事项',
    prerequisiteIds: [],
    task: `生成本章写作约束清单，使用 Markdown，必须包含：
1. 本章必须兑现的章纲事件与情绪目标；
2. 出场角色的动机、认知边界和关系状态；
3. 前章结尾、事实、物品、伏笔与世界规则约束；
4. 本章绝对不能出现的机械降神、开天眼、设定冲突和提前泄露；
5. 对上下文缺失或互相冲突处明确标注，不得自行编造为既定事实。`,
  },
  alternatives: {
    label: '方案竞选',
    description: '由多个模型独立提出剧情方案，作者选择一个',
    prerequisiteIds: ['constraints'],
    task: `你正在参加本章剧情方案竞选。根据已确认的约束扫描，独立提出一份有明确因果链的剧情方案，使用 Markdown，必须包含：
1. 一句话核心构想与本方案区别于常规写法的亮点；
2. 角色动机如何碰撞，并形成至少三步反应链；
3. 关键场景、信息揭示、代价与不可逆变化；
4. 情绪曲线和章末钩子；
5. 如何遵守不可写清单并避免机械降神、巧合推进和角色降智。
不要写小说正文，不要引用或猜测其他候选模型的方案。`,
  },
  beats: {
    label: '场景节拍',
    description: '把作者选中的方案展开为可执行场景和反应链',
    prerequisiteIds: ['constraints', 'alternatives'],
    task: `根据已确认的约束扫描和作者选中的竞选方案，生成可直接指导正文的场景节拍表。必须包含：
1. 视角人物、时间地点、开场状态；
2. 每个场景的目标、阻力、行动、反应链与信息增量；
3. 至少一次不可逆变化或代价；
4. 详写与略写安排、情绪曲线、章末钩子；
5. 所有安排都必须能从角色动机自然推出，不允许靠巧合推进。`,
  },
  draft: {
    label: '正文初稿',
    description: '依据约束和节拍生成完整小说正文',
    prerequisiteIds: ['constraints', 'alternatives', 'beats'],
    task: `根据已确认的约束扫描、作者选中的方案与场景节拍，写出完整章节初稿。
只输出小说正文，不要输出标题、Markdown 标题、说明、分析、字数统计或代码块。
正文必须有具体动作、感官、对话和人物内在反应，避免总结式叙述、模板排比与空泛抒情。
段落之间只使用一个换行，不要插入空白行。`,
  },
  review: {
    label: '连续性质检',
    description: '检查初稿中的设定、认知、节奏和文风问题',
    prerequisiteIds: ['constraints', 'alternatives', 'beats', 'draft'],
    task: `审查已确认的正文初稿，输出 Markdown 修改清单，不要重写正文。逐项检查：
1. 是否违反已确认约束、Canon、角色认知、物品持有和前章连续性；
2. 是否遗漏章纲目标、伏笔任务、情绪转折或章末钩子；
3. 是否存在角色降智、机械降神、巧合推进、信息重复和节奏停滞；
4. 是否存在 AI 模板腔、无意义排比、空泛心理总结和段落空行；
5. 每个问题给出准确位置、原因和可执行修改要求。没有证据的问题不要提出。`,
  },
  final: {
    label: '正式正文',
    description: '吸收质检意见，生成唯一可采纳的最终版本',
    prerequisiteIds: ['constraints', 'alternatives', 'beats', 'draft', 'review'],
    task: `根据已确认的约束、作者选中的方案、节拍、初稿和质检清单，生成完整最终正文。
只输出可直接写入章节 content 的小说正文，不要输出标题、Markdown 标题、修改说明、分析、字数统计或代码块。
必须处理质检中有证据的问题，同时保留初稿中有效的剧情事实和表达。
段落之间只使用一个换行，不要插入空白行。`,
  },
}

function assertPrerequisites(
  nodeId: ChapterWorkshopNodeId,
  artifacts: ChapterWorkshopArtifacts,
): void {
  const missing = NODE_META[nodeId].prerequisiteIds.filter(id => !artifacts[id]?.trim())
  if (missing.length > 0) {
    throw new Error(`请先确认前序阶段：${missing.map(id => NODE_META[id].label).join('、')}`)
  }
}

function confirmedArtifactsText(
  artifacts: ChapterWorkshopArtifacts,
  prerequisiteIds: readonly ChapterWorkshopNodeId[],
): string {
  return prerequisiteIds
    .map(id => `【已确认阶段：${NODE_META[id].label}】\n${artifacts[id]?.trim() ?? ''}`)
    .filter(Boolean)
    .join('\n\n')
}

async function assembleNodeMessages(
  nodeId: ChapterWorkshopNodeId,
  context: ChapterWorkshopContext,
): Promise<ChatMessage[]> {
  assertPrerequisites(nodeId, context.artifacts)
  const meta = NODE_META[nodeId]
  const artifactText = confirmedArtifactsText(context.artifacts, meta.prerequisiteIds)
  const assemble = context.assemble ?? assembleContext
  const assembled = await assemble({
    projectId: context.projectId,
    worldGroupId: context.worldGroupId,
    outlineNodeId: context.outlineNodeId,
    chapterId: context.chapterId,
    provider: context.provider,
    model: context.model,
    sourceKeys: [
      ...context.sourceKeys,
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
      content: `你是 StoryForge 正文工坊的“${meta.label}”节点。你只完成当前阶段，不越级交付后续产物。所有内容必须服从项目 Canon、世界规则、角色认知、连续性事实和已确认的前序阶段。使用简体中文。`,
    },
    {
      role: 'user',
      content: `【项目】${context.projectName}\n【类型】${context.genre || '未指定'}\n【章节】${context.chapterTitle}\n【章节大纲】${context.chapterSummary || '（尚未填写）'}\n\n【经 CONTEXT_SOURCES 装配的项目上下文】\n${assembled.text || '（暂无可用上下文）'}\n\n【当前阶段任务】\n${meta.task}${userConstraint}`,
    },
  ]
}

export function createChapterWorkshopNodes(): ChapterWorkshopNode[] {
  return CHAPTER_WORKSHOP_NODE_IDS.map(id => {
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
