import { describe, expect, it } from 'vitest'
import {
  buildAgentConversationHistory,
  createAgentConversation,
  createAgentConversationState,
  defaultConversationGroupId,
  loadAgentConversationState,
  saveAgentConversationState,
  type ConversationStorage,
} from '../../src/lib/agent/conversations'

class MemoryStorage implements ConversationStorage {
  readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('Agent conversation store', () => {
  it('maps original feature modules to stable default groups', () => {
    expect(defaultConversationGroupId('chapter-editor')).toBe('chapters')
    expect(defaultConversationGroupId('characters')).toBe('characters')
    expect(defaultConversationGroupId('outline')).toBe('outline')
    expect(defaultConversationGroupId('worldview-origin')).toBe('settings')
    expect(defaultConversationGroupId('inspiration')).toBe('project')
  })

  it('persists grouped conversations while compacting message deltas', () => {
    const storage = new MemoryStorage()
    const state = createAgentConversationState(7)
    const conversation = createAgentConversation({
      id: 'conversation-1', projectId: 7, module: 'chapters', title: '写第一章', now: 100,
    })
    conversation.turns.push({
      id: 'turn-1',
      userMessage: '写第一章',
      assistantMessage: '已生成方案',
      events: [
        event('message.delta', { text: '已生成' }),
        event('message.delta', { text: '方案' }),
        event('phase.started', { phase: 'step-1', label: 'Agent 步骤 1' }),
      ],
    })
    state.conversations.push(conversation)

    saveAgentConversationState(state, storage)
    const loaded = loadAgentConversationState(7, storage)

    expect(loaded.conversations[0]).toMatchObject({ title: '写第一章', groupId: 'chapters' })
    const events = loaded.conversations[0].turns[0].events
    expect(events.map(item => item.type)).toEqual(['message.delta', 'phase.started'])
    expect(events[0]).toMatchObject({ payload: { text: '已生成方案' } })
  })

  it('invalidates persisted approvals after a page reload', () => {
    const storage = new MemoryStorage()
    const state = createAgentConversationState(8)
    const conversation = createAgentConversation({ id: 'c', projectId: 8, module: 'outline' })
    const approval = event('approval.requested', {
      approvalId: 'approval-1', planId: 'plan-1', summary: '修改大纲',
    })
    conversation.turns.push({
      id: 't', userMessage: '改大纲', assistantMessage: '', events: [approval], waitingApproval: approval as never,
    })
    state.conversations.push(conversation)
    saveAgentConversationState(state, storage)

    const loaded = loadAgentConversationState(8, storage)
    expect(loaded.conversations[0].turns[0].waitingApproval).toBeUndefined()
    expect(loaded.conversations[0].turns[0].error).toContain('审批运行已失效')
  })

  it('restores a bounded model history using only completed visible messages', () => {
    const storage = new MemoryStorage()
    const state = createAgentConversationState(9)
    const current = createAgentConversation({ id: 'current', projectId: 9, module: 'chapters' })
    current.turns.push(
      turn('第一章写了什么？', '第一章写了林川进入山门。', [
        event('tool.completed', { toolCallId: 'tool-1', toolName: 'storyforge.context.read', output: { secret: true } }),
        event('reasoning.summary.completed', { text: '隐藏的阶段推理' }),
      ]),
      { ...turn('继续润色', '这是一段未完成输出'), error: '网络错误' },
    )
    const other = createAgentConversation({ id: 'other', projectId: 9, module: 'chapters' })
    other.turns.push(turn('另一个会话的问题', '另一个会话的回答'))
    state.conversations.push(current, other)

    saveAgentConversationState(state, storage)
    const loaded = loadAgentConversationState(9, storage)
    const restoredCurrent = loaded.conversations.find(item => item.id === 'current')
    if (!restoredCurrent) throw new Error('missing restored conversation')

    expect(buildAgentConversationHistory(restoredCurrent.turns)).toEqual([
      { role: 'user', content: '第一章写了什么？' },
      { role: 'assistant', content: '第一章写了林川进入山门。' },
    ])
    expect(JSON.stringify(buildAgentConversationHistory(restoredCurrent.turns))).not.toContain('secret')
    expect(JSON.stringify(buildAgentConversationHistory(restoredCurrent.turns))).not.toContain('隐藏的阶段推理')
    expect(JSON.stringify(buildAgentConversationHistory(restoredCurrent.turns))).not.toContain('另一个会话')
  })

  it('keeps the newest complete turn pairs within the history budget', () => {
    const turns = [
      turn('旧问题', '旧回答'),
      turn('较新问题', '较新回答'),
      turn('最新问题', '最新回答'),
    ]

    expect(buildAgentConversationHistory(turns, { maxTurns: 2, maxCharacters: 100 })).toEqual([
      { role: 'user', content: '较新问题' },
      { role: 'assistant', content: '较新回答' },
      { role: 'user', content: '最新问题' },
      { role: 'assistant', content: '最新回答' },
    ])
  })
})

function turn(userMessage: string, assistantMessage: string, events: ReturnType<typeof event>[] = []) {
  return { id: `turn-${userMessage}`, userMessage, assistantMessage, events }
}

function event(type: string, payload: Record<string, unknown>) {
  return {
    id: `${type}-1`, type, runId: 'run-1', conversationId: 'conversation-1',
    sequence: 1, timestamp: 100, payload,
  } as never
}
