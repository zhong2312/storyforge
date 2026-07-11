import { chat } from '../ai/client'
import { isAIConfigReady } from '../ai/config-readiness'
import { createAgentPromptProfile } from '../agent/prompts'
import { assembleContext } from '../registry/assemble-context'
import { adopt } from '../registry/adopt'
import type {
  AIModelRef,
  AIModelSceneBindings,
  AIProviderConfig,
  Character,
  PlotSimulationCharacterAction,
  PlotSimulationSession,
  PlotSimulationTurn,
  PlotSimulationWorldState,
} from '../types'
import { resolveAIModelConfig } from '../../stores/ai-config'
import { usePromptStore } from '../../stores/prompt'

export type PlotSimulationStage =
  | { type: 'world'; turnNumber: number; label: string }
  | { type: 'character'; turnNumber: number; characterId: number; label: string }
  | { type: 'narrator'; turnNumber: number; label: string }
  | { type: 'saved'; turnNumber: number; label: string }

export interface RunPlotSimulationInput {
  projectId: number
  session: PlotSimulationSession & { id: number }
  characters: Character[]
  existingTurns?: PlotSimulationTurn[]
  providerConfigs: AIProviderConfig[]
  sceneBindings: AIModelSceneBindings
  activeModelRef: AIModelRef
  signal?: AbortSignal
  onStage?: (stage: PlotSimulationStage) => void
}

export async function runPlotSimulation(input: RunPlotSimulationInput): Promise<PlotSimulationTurn[]> {
  const participants = input.characters.filter(character => (
    character.id != null && input.session.selectedCharacterIds.includes(character.id)
  ))
  if (!participants.length) throw new Error('至少选择一个参与推演的角色')
  const completed = [...(input.existingTurns ?? [])].sort((a, b) => a.turnNumber - b.turnNumber)

  await updateSession(input, { status: 'running', error: '' })
  try {
    for (let turnNumber = input.session.currentTurn + 1; turnNumber <= input.session.plannedTurns; turnNumber++) {
      throwIfAborted(input.signal)
      const turn = await runSimulationTurn(input, participants, completed, turnNumber)
      completed.push(turn)
      await updateSession(input, {
        currentTurn: turnNumber,
        status: turnNumber >= input.session.plannedTurns ? 'completed' : 'running',
      })
      input.onStage?.({ type: 'saved', turnNumber, label: `第 ${turnNumber} 回合已保存` })
    }
    return completed
  } catch (error) {
    await updateSession(input, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

async function runSimulationTurn(
  input: RunPlotSimulationInput,
  participants: Character[],
  completed: PlotSimulationTurn[],
  turnNumber: number,
): Promise<PlotSimulationTurn> {
  const previous = completed[completed.length - 1]
  const narratorRef = input.session.narratorModelRef ?? input.sceneBindings.chapter ?? input.activeModelRef
  const narratorConfig = resolveAIModelConfig(
    input.providerConfigs,
    input.sceneBindings,
    input.activeModelRef,
    'chapter',
    narratorRef,
  )
  assertReady(narratorConfig.model, isAIConfigReady(narratorConfig))
  const sourceKeys = [
    'storyCore', 'worldview', 'powerSystem', 'codex', 'characters', 'creativeRules',
    'worldRules', 'historical', 'locations', 'foreshadows', 'storyArcs', 'stateCards',
    'storyTimeline', 'ragSearch',
    ...(input.session.chapterId != null
      ? ['chapterOutline', 'detailedOutline', 'currentFacts', 'retrievedPassages']
      : []),
  ]
  const context = await assembleContext({
    projectId: input.projectId,
    worldGroupId: input.session.worldGroupId ?? null,
    chapterId: input.session.chapterId ?? null,
    sourceKeys,
    retrievalQuery: `${input.session.premise} ${input.session.goal} ${participants.map(item => item.name).join(' ')}`,
    retrievalTopK: 8,
    provider: narratorConfig.provider,
    model: narratorConfig.model,
  })
  const previousState = previous
    ? JSON.stringify({ summary: previous.summary, worldChanges: previous.worldChanges, hooks: previous.unresolvedHooks })
    : '这是第一回合，尚无前序推演。'

  input.onStage?.({ type: 'world', turnNumber, label: `第 ${turnNumber} 回合：世界演化` })
  const worldState = await generateWorldState(input, context.text, previousState, turnNumber, narratorRef)
  const characterActions: PlotSimulationCharacterAction[] = []
  for (const character of participants) {
    throwIfAborted(input.signal)
    input.onStage?.({
      type: 'character',
      turnNumber,
      characterId: character.id!,
      label: `第 ${turnNumber} 回合：${character.name} 自主决策`,
    })
    characterActions.push(await generateCharacterAction(input, character, context.text, previousState, worldState, turnNumber))
  }

  input.onStage?.({ type: 'narrator', turnNumber, label: `第 ${turnNumber} 回合：旁白裁决与成文` })
  const narrated = await generateNarration(
    input,
    context.text,
    previousState,
    worldState,
    characterActions,
    turnNumber,
    narratorRef,
  )
  const data = {
    sessionId: input.session.id,
    turnNumber,
    worldState,
    characterActions,
    narration: narrated.narration,
    summary: narrated.summary,
    worldChanges: narrated.worldChanges,
    unresolvedHooks: narrated.unresolvedHooks,
  }
  const result = await adopt({
    projectId: input.projectId,
    target: 'plotSimulationTurns',
    mode: 'add',
    data,
  })
  const id = result.written[0]?.id
  if (id == null) throw new Error(`第 ${turnNumber} 回合保存失败`)
  const now = Date.now()
  return { ...data, id, projectId: input.projectId, createdAt: now, updatedAt: now }
}

async function generateWorldState(
  input: RunPlotSimulationInput,
  context: string,
  previousState: string,
  turnNumber: number,
  modelRef: AIModelRef,
): Promise<PlotSimulationWorldState> {
  const config = resolveAIModelConfig(input.providerConfigs, input.sceneBindings, input.activeModelRef, 'settings', modelRef)
  const profile = createAgentPromptProfile(usePromptStore.getState().getActive('story.generate'))
  const output = await chat([
    {
      role: 'system',
      content: `${profile.systemPrompt}\n\n你现在是剧情推演的世界导演。世界必须按既有规则独立发展，不为角色让路。只输出 JSON。`,
    },
    {
      role: 'user',
      content: `项目上下文：\n${context}\n\n推演前提：${input.session.premise}\n推演目标：${input.session.goal}\n前序状态：${previousState}\n当前第 ${turnNumber} 回合。\n输出：{"pressure":"本回合世界压力","events":["世界事件"],"constraints":["不可违反的规则"]}`,
    },
  ], config, { category: 'simulation.world', projectId: input.projectId }, input.signal)
  const parsed = parseJsonObject(output)
  return {
    pressure: textField(parsed, 'pressure', '局势继续发展'),
    events: stringArray(parsed.events),
    constraints: stringArray(parsed.constraints),
  }
}

async function generateCharacterAction(
  input: RunPlotSimulationInput,
  character: Character,
  context: string,
  previousState: string,
  worldState: PlotSimulationWorldState,
  turnNumber: number,
): Promise<PlotSimulationCharacterAction> {
  const modelRef = character.simulationModelRef
    ?? input.session.defaultCharacterModelRef
    ?? input.sceneBindings.settings
    ?? input.activeModelRef
  const config = resolveAIModelConfig(input.providerConfigs, input.sceneBindings, input.activeModelRef, 'settings', modelRef)
  assertReady(`${character.name} / ${config.model}`, isAIConfigReady(config))
  const profile = createAgentPromptProfile(usePromptStore.getState().getActive('character.generate'))
  const output = await chat([
    {
      role: 'system',
      content: `${profile.systemPrompt}\n\n你只扮演“${character.name}”。基于角色已知信息、有限视角和自身利益自主决定，不得替其他角色行动。只输出 JSON。`,
    },
    {
      role: 'user',
      content: `项目上下文：\n${context}\n\n前序状态：${previousState}\n第 ${turnNumber} 回合世界状态：${JSON.stringify(worldState)}\n角色额外约束：${character.simulationInstructions || '无'}\n输出：{"intent":"真实意图","action":"可观察动作","dialogue":"本回合台词，可为空","innerThought":"内心活动","stateChange":"回合后的状态变化"}`,
    },
  ], config, { category: 'simulation.character', projectId: input.projectId }, input.signal)
  const parsed = parseJsonObject(output)
  return {
    characterId: character.id!,
    characterName: character.name,
    intent: textField(parsed, 'intent', '观察局势'),
    action: textField(parsed, 'action', '暂时按兵不动'),
    dialogue: textField(parsed, 'dialogue', ''),
    innerThought: textField(parsed, 'innerThought', ''),
    stateChange: textField(parsed, 'stateChange', '无明显变化'),
    modelRef,
  }
}

async function generateNarration(
  input: RunPlotSimulationInput,
  context: string,
  previousState: string,
  worldState: PlotSimulationWorldState,
  actions: PlotSimulationCharacterAction[],
  turnNumber: number,
  modelRef: AIModelRef,
): Promise<{ narration: string; summary: string; worldChanges: string[]; unresolvedHooks: string[] }> {
  const config = resolveAIModelConfig(input.providerConfigs, input.sceneBindings, input.activeModelRef, 'chapter', modelRef)
  const profile = createAgentPromptProfile(usePromptStore.getState().getActive('chapter.content'))
  const output = await chat([
    {
      role: 'system',
      content: `${profile.systemPrompt}\n\n你是中立旁白与冲突裁决者。不能篡改角色已作出的选择；根据世界规则判断行动结果，用小说叙事呈现动作、对话和必要的心理活动。只输出 JSON。`,
    },
    {
      role: 'user',
      content: `项目上下文：\n${context}\n\n前序状态：${previousState}\n第 ${turnNumber} 回合世界状态：${JSON.stringify(worldState)}\n角色自主行动：${JSON.stringify(actions)}\n输出：{"narration":"不少于400字的正式小说场景，不含分析说明","summary":"回合摘要","worldChanges":["已发生的客观变化"],"unresolvedHooks":["留待后续的冲突或问题"]}`,
    },
  ], config, { category: 'simulation.narrator', projectId: input.projectId }, input.signal)
  const parsed = parseJsonObject(output)
  const narration = textField(parsed, 'narration', '')
  if (narration.replace(/\s/g, '').length < 200) throw new Error(`第 ${turnNumber} 回合旁白内容过短`)
  return {
    narration,
    summary: textField(parsed, 'summary', narration.slice(0, 120)),
    worldChanges: stringArray(parsed.worldChanges),
    unresolvedHooks: stringArray(parsed.unresolvedHooks),
  }
}

async function updateSession(
  input: RunPlotSimulationInput,
  patch: Record<string, unknown>,
): Promise<void> {
  const result = await adopt({
    projectId: input.projectId,
    target: 'plotSimulationSessions',
    recordId: input.session.id,
    mode: 'merge-diffs',
    data: patch,
  })
  if (!result.written.length) throw new Error('推演会话状态保存失败')
}

function parseJsonObject(output: string): Record<string, unknown> {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced ?? output.match(/\{[\s\S]*\}/)?.[0]
  if (!candidate) throw new Error('模型未返回结构化推演结果')
  const parsed = JSON.parse(candidate) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('模型推演结果不是对象')
  return parsed as Record<string, unknown>
}

function textField(record: Record<string, unknown>, field: string, fallback: string): string {
  const value = record[field]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()).map(item => item.trim()) : []
}

function assertReady(label: string, ready: boolean): void {
  if (!ready) throw new Error(`模型“${label}”未配置 API Key`)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('剧情推演已停止', 'AbortError')
}
