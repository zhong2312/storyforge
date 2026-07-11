import { describe, expect, it } from 'vitest'
import {
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
        event('phase.started', { phase: 'step-1', label: 'Agent 步骤 1' }),
      ],
    })
    state.conversations.push(conversation)

    saveAgentConversationState(state, storage)
    const loaded = loadAgentConversationState(7, storage)

    expect(loaded.conversations[0]).toMatchObject({ title: '写第一章', groupId: 'chapters' })
    expect(loaded.conversations[0].turns[0].events.map(item => item.type)).toEqual(['phase.started'])
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
})

function event(type: string, payload: Record<string, unknown>) {
  return {
    id: `${type}-1`, type, runId: 'run-1', conversationId: 'conversation-1',
    sequence: 1, timestamp: 100, payload,
  } as never
}
