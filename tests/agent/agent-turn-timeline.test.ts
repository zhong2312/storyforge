import { describe, expect, it } from 'vitest'
import { collectAgentTurnTimeline } from '../../src/lib/agent/conversations'
import type { AgentEvent } from '../../src/lib/agent/events/agent-events'

describe('Agent turn timeline', () => {
  it('keeps phase descriptions before or after tools according to event sequence', () => {
    const timeline = collectAgentTurnTimeline([
      event(1, 'phase.started', { phase: 'step-1', label: '读取上下文' }),
      event(2, 'message.delta', { text: '先读取本章设定。' }),
      event(3, 'tool.requested', {
        toolCallId: 'tool-1', toolName: 'storyforge.context.read', summary: '读取章纲',
      }),
      event(4, 'tool.started', { toolCallId: 'tool-1', toolName: 'storyforge.context.read' }),
      event(5, 'tool.completed', {
        toolCallId: 'tool-1', toolName: 'storyforge.context.read', summary: '已读取章纲',
      }),
      event(6, 'message.delta', { text: '上下文已齐备，开始生成正文。' }),
      event(7, 'phase.completed', { phase: 'step-1' }),
      event(8, 'message.completed', { text: '先读取本章设定。上下文已齐备，开始生成正文。' }),
    ])

    expect(timeline.phases).toHaveLength(1)
    expect(timeline.phases[0].items.map(item => item.kind)).toEqual(['message', 'tool', 'message'])
    expect(timeline.finalMessages).toEqual([])
  })

  it('keeps non-streamed completion messages as final output without duplicating streamed text', () => {
    const timeline = collectAgentTurnTimeline([
      event(1, 'phase.started', { phase: 'commit', label: '提交变更' }),
      event(2, 'phase.completed', { phase: 'commit' }),
      event(3, 'message.completed', { text: '已采纳最终版本并写入当前章节。' }),
    ])

    expect(timeline.finalMessages.map(item => item.text)).toEqual(['已采纳最终版本并写入当前章节。'])
  })
})

function event(
  sequence: number,
  type: AgentEvent['type'],
  payload: Record<string, unknown>,
): AgentEvent {
  return {
    id: `event-${sequence}`,
    type,
    runId: 'run-1',
    conversationId: 'conversation-1',
    sequence,
    timestamp: sequence * 100,
    payload,
  } as AgentEvent
}
