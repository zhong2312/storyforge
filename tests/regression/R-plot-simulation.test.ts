import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, StoryForgeDB } from '../../src/lib/db/schema'
import { adopt } from '../../src/lib/registry/adopt'
import { runPlotSimulation } from '../../src/lib/simulation/plot-simulation-engine'
import type { AIProviderConfig, Character, PlotSimulationSession } from '../../src/lib/types'

const now = Date.now()

describe('剧情自动推演', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => {
    vi.restoreAllMocks()
    db.close()
  })

  it('会话与回合统一通过 adopt 写回全部结构字段', async () => {
    const projectId = await createProject()
    const characterId = await db.characters.add(character('闻铃', projectId)) as number
    const sessionResult = await adopt({
      projectId,
      target: 'plotSimulationSessions',
      mode: 'add',
      data: {
        sessionKey: 'session-1', title: '北境夜战', premise: '城门将破', goal: '观察闻铃如何抉择', status: 'draft',
        worldGroupId: null, chapterId: null, selectedCharacterIds: [characterId],
        narratorModelRef: { providerConfigId: 'p', modelId: 'narrator' },
        defaultCharacterModelRef: { providerConfigId: 'p', modelId: 'actor' },
        plannedTurns: 2, currentTurn: 0,
      },
    })
    expect(sessionResult.unknown).toEqual([])
    const sessionId = sessionResult.written[0].id
    const turnResult = await adopt({
      projectId,
      target: 'plotSimulationTurns',
      mode: 'add',
      data: {
        sessionId, turnNumber: 1,
        worldState: { pressure: '城门失守', events: ['敌军入城'], constraints: ['不能瞬移'] },
        characterActions: [{ characterId, characterName: '闻铃', action: '迎敌' }],
        narration: '闻铃提刀走上城墙。', summary: '迎战',
        worldChanges: ['守军集结'], unresolvedHooks: ['援军未至'],
      },
    })
    expect(turnResult.unknown).toEqual([])
    expect(await db.plotSimulationTurns.get(turnResult.written[0].id)).toMatchObject({
      sessionId,
      turnNumber: 1,
      narration: '闻铃提刀走上城墙。',
      worldChanges: ['守军集结'],
    })
  })

  it('按世界→各角色→旁白顺序调用角色绑定模型并持久化回合', async () => {
    const projectId = await createProject()
    const providerConfigs = providerCatalog()
    const ref = (modelId: string) => ({ providerConfigId: 'provider', modelId })
    const firstId = await db.characters.add({ ...character('沈砚', projectId), background: '沈砚私密身世', simulationModelRef: ref('actor-a') }) as number
    const secondId = await db.characters.add({ ...character('闻铃', projectId), background: '闻铃秘密动机', simulationModelRef: ref('actor-b') }) as number
    const sessionResult = await adopt({
      projectId,
      target: 'plotSimulationSessions',
      mode: 'add',
      data: {
        sessionKey: 'session-2', title: '潮汐神殿', premise: '神殿即将坍塌', goal: '观察两人是否合作', status: 'draft',
        worldGroupId: null, chapterId: null, selectedCharacterIds: [firstId, secondId],
        narratorModelRef: ref('narrator'), defaultCharacterModelRef: ref('actor-a'),
        plannedTurns: 1, currentTurn: 0,
      },
    })
    const session = await db.plotSimulationSessions.get(sessionResult.written[0].id) as PlotSimulationSession & { id: number }
    const responses = [
      { pressure: '穹顶持续坍塌', events: ['潮水倒灌'], constraints: ['出口只容一人通过'] },
      { intent: '先救同伴', action: '撑住石门', dialogue: '快走！', innerThought: '不能再失去同伴', stateChange: '左臂受伤' },
      { intent: '寻找双赢出口', action: '启动排水机关', dialogue: '一起走。', innerThought: '机关还能运转', stateChange: '取得机关控制权' },
      { narration: '潮水撞上石阶。'.repeat(30), summary: '两人合作打开排水机关', worldChanges: ['神殿停止坍塌'], unresolvedHooks: ['机关唤醒未知存在'] },
    ]
    const bodies: Array<{ model: string; messages: Array<{ content: string }> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: string }> })
      const content = JSON.stringify(responses.shift())
      return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) } as Response
    }))
    const stages: string[] = []
    const turns = await runPlotSimulation({
      projectId,
      session,
      characters: [
        { ...character('沈砚', projectId), id: firstId, simulationModelRef: ref('actor-a') },
        { ...character('闻铃', projectId), id: secondId, simulationModelRef: ref('actor-b') },
      ],
      providerConfigs,
      sceneBindings: { settings: ref('actor-a'), chapter: ref('narrator') },
      activeModelRef: ref('narrator'),
      onStage: stage => stages.push(stage.type),
    })

    expect(bodies.map(body => body.model)).toEqual(['narrator-model', 'actor-a-model', 'actor-b-model', 'narrator-model'])
    expect(JSON.stringify(bodies[1].messages)).toContain('沈砚私密身世')
    expect(JSON.stringify(bodies[1].messages)).not.toContain('闻铃秘密动机')
    expect(JSON.stringify(bodies[2].messages)).toContain('闻铃秘密动机')
    expect(JSON.stringify(bodies[2].messages)).not.toContain('沈砚私密身世')
    expect(stages).toEqual(['world', 'character', 'character', 'narrator', 'saved'])
    expect(turns).toHaveLength(1)
    expect(turns[0].characterActions.map(action => action.characterName)).toEqual(['沈砚', '闻铃'])
    expect(turns[0].narration).toContain('潮水撞上石阶')
    expect(await db.plotSimulationTurns.where('sessionId').equals(session.id).count()).toBe(1)
    expect(await db.plotSimulationSessions.get(session.id)).toMatchObject({ status: 'completed', currentTurn: 1 })
  })

  it('续跑以已保存回合为检查点，不重复生成已完成回合', async () => {
    const projectId = await createProject()
    const ref = (modelId: string) => ({ providerConfigId: 'provider', modelId })
    const characterId = await db.characters.add({ ...character('闻铃', projectId), simulationModelRef: ref('actor-a') }) as number
    const sessionResult = await adopt({
      projectId,
      target: 'plotSimulationSessions',
      mode: 'add',
      data: {
        sessionKey: 'resume', title: '续跑', premise: '城门将破', goal: '继续行动', status: 'failed',
        selectedCharacterIds: [characterId], narratorModelRef: ref('narrator'),
        defaultCharacterModelRef: ref('actor-a'), plannedTurns: 2, currentTurn: 0,
      },
    })
    const session = await db.plotSimulationSessions.get(sessionResult.written[0].id) as PlotSimulationSession & { id: number }
    const previous = {
      id: 99,
      projectId,
      sessionId: session.id,
      turnNumber: 1,
      worldState: { pressure: '旧压力', events: [], constraints: [] },
      characterActions: [],
      narration: '第一回合已完成。'.repeat(30),
      summary: '第一回合',
      worldChanges: [],
      unresolvedHooks: [],
      createdAt: now,
      updatedAt: now,
    }
    await db.plotSimulationTurns.add(previous as any)
    const responses = [
      { pressure: '新压力', events: [], constraints: [] },
      { intent: '守城', action: '登城', dialogue: '', innerThought: '', stateChange: '无' },
      { narration: '第二回合继续推进。'.repeat(30), summary: '第二回合', worldChanges: [], unresolvedHooks: [] },
    ]
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push((JSON.parse(String(init?.body)) as { model: string }).model)
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(responses.shift()) } }] }) } as Response
    }))

    const turns = await runPlotSimulation({
      projectId,
      session,
      characters: [{ ...character('闻铃', projectId), id: characterId, simulationModelRef: ref('actor-a') }],
      existingTurns: [previous as any],
      providerConfigs: providerCatalog(),
      sceneBindings: { settings: ref('actor-a'), chapter: ref('narrator') },
      activeModelRef: ref('narrator'),
    })
    expect(calls).toEqual(['narrator-model', 'actor-a-model', 'narrator-model'])
    expect(turns.map(turn => turn.turnNumber)).toEqual([1, 2])
    expect(await db.plotSimulationTurns.where('sessionId').equals(session.id).count()).toBe(2)
    expect(await db.plotSimulationSessions.get(session.id)).toMatchObject({ currentTurn: 2, status: 'completed' })
  })
})

describe('DB v39 剧情推演迁移', () => {
  const names: string[] = []
  const opened: Dexie[] = []

  afterEach(async () => {
    for (const database of opened.splice(0)) database.close()
    for (const name of names.splice(0)) await Dexie.delete(name)
  })

  it('从 v38 升级时保留项目并创建两张可写推演表', async () => {
    const name = `plot-simulation-upgrade-${Math.random()}`
    names.push(name)
    const legacy = new Dexie(name)
    opened.push(legacy)
    legacy.version(38).stores({ projects: '++id, name, createdAt, updatedAt' })
    await legacy.open()
    const projectId = await legacy.table('projects').add({ name: '旧项目', createdAt: now, updatedAt: now }) as number
    legacy.close()

    const upgraded = new StoryForgeDB(name)
    opened.push(upgraded)
    await upgraded.open()
    expect((await upgraded.projects.get(projectId))?.name).toBe('旧项目')
    expect(upgraded.tables.map(table => table.name)).toEqual(expect.arrayContaining(['plotSimulationSessions', 'plotSimulationTurns']))
    const sessionId = await upgraded.plotSimulationSessions.add({
      projectId, sessionKey: 'upgrade-session', title: '测试', premise: '前提', goal: '目标', status: 'draft',
      selectedCharacterIds: [], plannedTurns: 1, currentTurn: 0, createdAt: now, updatedAt: now,
    })
    await expect(upgraded.plotSimulationTurns.add({
      projectId, sessionId, turnNumber: 1,
      worldState: { pressure: '', events: [], constraints: [] }, characterActions: [],
      narration: '正文', summary: '摘要', worldChanges: [], unresolvedHooks: [], createdAt: now, updatedAt: now,
    })).resolves.toBeTypeOf('number')
  })
})

async function createProject(): Promise<number> {
  return await db.projects.add({ name: 'P', genre: 'x', createdAt: now, updatedAt: now } as any) as number
}

function character(name: string, projectId: number): Character {
  return {
    projectId, name, role: 'supporting', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
    shortDescription: '', appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '', arc: '',
    createdAt: now, updatedAt: now,
  }
}

function providerCatalog(): AIProviderConfig[] {
  const model = (id: string, modelName: string) => ({
    id, name: id, model: modelName, temperature: 0.7, maxTokens: 2000, contextWindow: 64_000,
  })
  return [{
    id: 'provider', name: '测试供应商', provider: 'custom', apiFormat: 'openai-compatible', apiKey: 'test-key', baseUrl: 'https://example.test/v1',
    models: [model('narrator', 'narrator-model'), model('actor-a', 'actor-a-model'), model('actor-b', 'actor-b-model')],
  }]
}
