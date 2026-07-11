import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agentScopeFromIntent,
  buildAgentIntentPrompt,
  dispatchAgentProjectCommit,
  dispatchAgentIntent,
  isIntentForDexieProject,
  subscribeAgentIntents,
  subscribeAgentProjectCommits,
} from '../../src/lib/agent/intents'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AgentIntent panel bridge', () => {
  it('dispatches an immutable structured intent to the workspace host', () => {
    const received: unknown[] = []
    const unsubscribe = subscribeAgentIntents(intent => received.push(intent))

    const intent = dispatchAgentIntent({
      id: 'intent-1',
      type: 'chapter.content',
      title: 'Agent 生成本章正文',
      source: {
        project: { backend: 'dexie', projectId: 7 },
        module: 'editor',
        worldGroupId: 2,
        outlineNodeId: 11,
        chapterId: 12,
      },
      instruction: '生成正文并提案写入。',
      payload: { customInstruction: '节奏紧凑' },
    })

    unsubscribe()
    expect(received).toEqual([intent])
    expect(Object.isFrozen(intent)).toBe(true)
    expect(Object.isFrozen(intent.source)).toBe(true)
    expect(Object.isFrozen(intent.payload)).toBe(true)
  })

  it('preserves host scope and writes it into the agent prompt', () => {
    const intent = dispatchAgentIntent({
      id: 'intent-2',
      type: 'chapter.polish',
      title: 'Agent 润色本章',
      source: {
        project: { backend: 'dexie', projectId: 7 },
        module: 'editor',
        worldGroupId: 2,
        outlineNodeId: 11,
        chapterId: 12,
        entityId: 12,
        selection: { text: '原始选区' },
      },
      instruction: '润色选区并更新完整正文。',
      payload: { chapterTitle: '山门夜雨' },
    })

    expect(agentScopeFromIntent(intent)).toMatchObject({
      module: 'editor', worldGroupId: 2, outlineNodeId: 11, chapterId: 12, entityId: 12,
    })
    const prompt = buildAgentIntentPrompt(intent)
    expect(prompt).toContain('章节ID=12')
    expect(prompt).toContain('实体ID=12')
    expect(prompt).toContain('山门夜雨')
    expect(prompt).toContain('原始选区')
    expect(prompt).toContain('storyforge.change.propose')
  })

  it('rejects intents targeting another project at the workspace boundary', () => {
    const intent = dispatchAgentIntent({
      id: 'intent-3',
      type: 'character.generate',
      title: 'Agent 设计角色',
      source: { project: { backend: 'dexie', projectId: 8 }, module: 'characters' },
      instruction: '新增角色。',
    })

    expect(isIntentForDexieProject(intent, 7)).toBe(false)
    expect(isIntentForDexieProject(intent, 8)).toBe(true)
  })

  it('publishes approved commit scope for host post-processing', () => {
    const received: unknown[] = []
    const unsubscribe = subscribeAgentProjectCommits(commit => received.push(commit))

    dispatchAgentProjectCommit({
      project: { backend: 'dexie', projectId: 7 },
      scope: { module: 'editor', chapterId: 12, outlineNodeId: 11 },
      intentType: 'chapter.content',
    })

    unsubscribe()
    expect(received).toEqual([{
      project: { backend: 'dexie', projectId: 7 },
      scope: { module: 'editor', chapterId: 12, outlineNodeId: 11 },
      intentType: 'chapter.content',
    }])
  })
})
