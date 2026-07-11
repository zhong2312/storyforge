import { describe, expect, it } from 'vitest'
import {
  type NewAgentEvent,
  isTerminalAgentEvent,
} from '../../src/lib/agent/events/agent-events'
import { InMemoryAgentEventLog } from '../../src/lib/agent/events/in-memory-agent-event-log'

const runId = 'run-1'
const conversationId = 'conversation-1'

function acceptNewAgentEvent(_event: NewAgentEvent): void {
  // Compile-time helper: callers may provide only new event fields.
}

describe('NewAgentEvent', () => {
  it('documents compile-time input constraints', () => {
    const legal: NewAgentEvent = {
      type: 'message.delta',
      runId,
      conversationId,
      payload: { text: 'hello' },
    }

    acceptNewAgentEvent(legal)
    acceptNewAgentEvent({
      type: 'tool.started',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', toolName: 'search' },
    })

    acceptNewAgentEvent({
      type: 'run.started',
      runId,
      conversationId,
      payload: { userMessage: 'Start' },
      // @ts-expect-error - generated id is owned by the event log.
      id: 'caller-id',
    })

    acceptNewAgentEvent({
      type: 'run.started',
      runId,
      conversationId,
      payload: { userMessage: 'Start' },
      // @ts-expect-error - generated sequence is owned by the event log.
      sequence: 1,
    })

    acceptNewAgentEvent({
      type: 'run.started',
      runId,
      conversationId,
      payload: { userMessage: 'Start' },
      // @ts-expect-error - generated timestamp is owned by the event log.
      timestamp: 1,
    })

    acceptNewAgentEvent({
      type: 'tool.started',
      runId,
      conversationId,
      payload: {
        // @ts-expect-error - payload shape must match the discriminant type.
        text: 'wrong payload',
      },
    })
  })
})

describe('InMemoryAgentEventLog', () => {
  it('generates non-empty ids, increments per-run sequence, and lists events in order', () => {
    const log = new InMemoryAgentEventLog()

    const first = log.append({
      type: 'run.started',
      runId,
      conversationId,
      payload: { userMessage: 'Start writing' },
    })
    const second = log.append({
      type: 'phase.started',
      runId,
      conversationId,
      payload: { phase: 'planning', label: 'Planning' },
    })

    expect(typeof first.id).toBe('string')
    expect(first.id.length).toBeGreaterThan(0)
    expect(typeof second.id).toBe('string')
    expect(second.id.length).toBeGreaterThan(0)
    expect(first.sequence).toBe(1)
    expect(second.sequence).toBe(2)
    expect(log.list(runId).map(event => event.id)).toEqual([first.id, second.id])
  })

  it('keeps independent sequence counters for interleaved runs', () => {
    const log = new InMemoryAgentEventLog()

    const firstRunFirst = log.append({
      type: 'run.started',
      runId: 'run-a',
      conversationId: 'conversation-a',
      payload: { userMessage: 'Start A' },
    })
    const secondRunFirst = log.append({
      type: 'run.started',
      runId: 'run-b',
      conversationId: 'conversation-b',
      payload: { userMessage: 'Start B' },
    })
    const firstRunSecond = log.append({
      type: 'message.delta',
      runId: 'run-a',
      conversationId: 'conversation-a',
      payload: { text: 'A continues' },
    })

    expect(firstRunFirst.sequence).toBe(1)
    expect(secondRunFirst.sequence).toBe(1)
    expect(firstRunSecond.sequence).toBe(2)
    expect(new Set([firstRunFirst.id, secondRunFirst.id, firstRunSecond.id]).size).toBe(3)
    expect(typeof firstRunFirst.timestamp).toBe('number')
    expect(typeof secondRunFirst.timestamp).toBe('number')
    expect(typeof firstRunSecond.timestamp).toBe('number')
  })

  it('rejects tool terminal events and progress before the tool starts', () => {
    const log = new InMemoryAgentEventLog()

    expect(() => log.append({
      type: 'tool.completed',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', toolName: 'search', summary: 'done' },
    })).toThrow('tool tool-1 has not started')

    expect(() => log.append({
      type: 'tool.failed',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', toolName: 'search', error: 'boom' },
    })).toThrow('tool tool-1 has not started')

    expect(() => log.append({
      type: 'tool.progress',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', message: 'halfway', percent: 50 },
    })).toThrow('tool tool-1 has not started')
  })

  it('enforces active tool state, toolName consistency, and terminal tool state', () => {
    const log = new InMemoryAgentEventLog()

    log.append({
      type: 'tool.started',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', toolName: 'search' },
    })

    expect(() => log.append({
      type: 'tool.started',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', toolName: 'search' },
    })).toThrow('tool tool-1 duplicate started')

    expect(() => log.append({
      type: 'tool.completed',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', toolName: 'other-tool', summary: 'done' },
    })).toThrow('tool tool-1 tool name mismatch')

    log.append({
      type: 'tool.progress',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', message: 'halfway', percent: 50 },
    })
    log.append({
      type: 'tool.completed',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', toolName: 'search', summary: 'done' },
    })

    expect(() => log.append({
      type: 'tool.completed',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', toolName: 'search', summary: 'again' },
    })).toThrow('tool tool-1 is already terminal')
    expect(() => log.append({
      type: 'tool.failed',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', toolName: 'search', error: 'late failure' },
    })).toThrow('tool tool-1 is already terminal')
    expect(() => log.append({
      type: 'tool.progress',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', message: 'late progress' },
    })).toThrow('tool tool-1 is already terminal')
    expect(() => log.append({
      type: 'tool.started',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', toolName: 'search' },
    })).toThrow('tool tool-1 is already terminal')
  })

  it('rejects completed after failed for the same toolCallId', () => {
    const log = new InMemoryAgentEventLog()

    log.append({
      type: 'tool.started',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-2', toolName: 'search' },
    })
    log.append({
      type: 'tool.failed',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-2', toolName: 'search', error: 'boom' },
    })

    expect(() => log.append({
      type: 'tool.completed',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-2', toolName: 'search', summary: 'late done' },
    })).toThrow('tool tool-2 is already terminal')
  })

  it('rejects approval.resolved when approval is not pending or was already resolved', () => {
    const log = new InMemoryAgentEventLog()

    expect(() => log.append({
      type: 'approval.resolved',
      runId,
      conversationId,
      payload: { approvalId: 'approval-1', decision: 'approved' },
    })).toThrow('approval approval-1 is not pending')

    log.append({
      type: 'approval.requested',
      runId,
      conversationId,
      payload: { approvalId: 'approval-1', planId: 'plan-1', summary: 'Approve plan' },
    })
    log.append({
      type: 'approval.resolved',
      runId,
      conversationId,
      payload: { approvalId: 'approval-1', decision: 'approved' },
    })

    expect(() => log.append({
      type: 'approval.resolved',
      runId,
      conversationId,
      payload: { approvalId: 'approval-1', decision: 'rejected' },
    })).toThrow('approval approval-1 is not pending')
  })

  it('enforces approval ID uniqueness across pending and resolved states within a run', () => {
    const log = new InMemoryAgentEventLog()

    log.append({
      type: 'approval.requested',
      runId,
      conversationId,
      payload: { approvalId: 'approval-1', planId: 'plan-1', summary: 'Approve plan' },
    })

    expect(() => log.append({
      type: 'approval.requested',
      runId,
      conversationId,
      payload: { approvalId: 'approval-1', planId: 'plan-2', summary: 'Approve other plan' },
    })).toThrow('approval approval-1 duplicate requested')

    log.append({
      type: 'approval.resolved',
      runId,
      conversationId,
      payload: { approvalId: 'approval-1', decision: 'edited' },
    })

    expect(() => log.append({
      type: 'approval.requested',
      runId,
      conversationId,
      payload: { approvalId: 'approval-1', planId: 'plan-3', summary: 'Reuse ID' },
    })).toThrow('approval approval-1 duplicate requested')
  })

  it('binds each runId to the first conversationId before other validations', () => {
    const log = new InMemoryAgentEventLog()

    log.append({
      type: 'tool.started',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', toolName: 'search' },
    })

    expect(() => log.append({
      type: 'tool.completed',
      runId,
      conversationId: 'conversation-2',
      payload: { toolCallId: 'tool-1', toolName: 'search', summary: 'done' },
    })).toThrow('[agent-events] run-1 conversation mismatch')
  })

  it('checks conversation mismatch before terminal run rejection', () => {
    const log = new InMemoryAgentEventLog()

    log.append({
      type: 'run.completed',
      runId,
      conversationId,
      payload: { summary: 'Finished' },
    })

    expect(() => log.append({
      type: 'phase.started',
      runId,
      conversationId: 'conversation-2',
      payload: { phase: 'finalize', label: 'Finalize' },
    })).toThrow('[agent-events] run-1 conversation mismatch')
  })

  it('rejects appends after each run terminal state and identifies non-terminal events', () => {
    const completedLog = new InMemoryAgentEventLog()
    const failedLog = new InMemoryAgentEventLog()
    const cancelledLog = new InMemoryAgentEventLog()
    const activeLog = new InMemoryAgentEventLog()

    const completed = completedLog.append({
      type: 'run.completed',
      runId: 'completed-run',
      conversationId,
      payload: { summary: 'Finished' },
    })
    const failed = failedLog.append({
      type: 'run.failed',
      runId: 'failed-run',
      conversationId,
      payload: { error: 'Failed' },
    })
    const cancelled = cancelledLog.append({
      type: 'run.cancelled',
      runId: 'cancelled-run',
      conversationId,
      payload: { reason: 'Stopped' },
    })
    const nonTerminal = activeLog.append({
      type: 'phase.started',
      runId: 'active-run',
      conversationId,
      payload: { phase: 'planning', label: 'Planning' },
    })

    expect(isTerminalAgentEvent(completed)).toBe(true)
    expect(isTerminalAgentEvent(failed)).toBe(true)
    expect(isTerminalAgentEvent(cancelled)).toBe(true)
    expect(isTerminalAgentEvent(nonTerminal)).toBe(false)
    expect(() => completedLog.append({
      type: 'phase.started',
      runId: 'completed-run',
      conversationId,
      payload: { phase: 'finalize', label: 'Finalize' },
    })).toThrow('[agent-events] completed-run is already terminal')
    expect(() => failedLog.append({
      type: 'phase.started',
      runId: 'failed-run',
      conversationId,
      payload: { phase: 'finalize', label: 'Finalize' },
    })).toThrow('[agent-events] failed-run is already terminal')
    expect(() => cancelledLog.append({
      type: 'phase.started',
      runId: 'cancelled-run',
      conversationId,
      payload: { phase: 'finalize', label: 'Finalize' },
    })).toThrow('[agent-events] cancelled-run is already terminal')
  })

  it('does not let append input, append output, or list output mutation pollute stored events', () => {
    const log = new InMemoryAgentEventLog()
    const input = {
      type: 'message.completed' as const,
      runId,
      conversationId,
      payload: { text: 'original' },
    }

    const appended = log.append(input)
    input.payload.text = 'mutated input'
    const appendedPayload = appended.payload as { text: string }
    appendedPayload.text = 'mutated append output'

    const storedAfterAppendMutation = log.list(runId)[0] as { payload: { text: string } }
    expect(storedAfterAppendMutation.payload.text).toBe('original')

    const listed = log.list(runId)
    const listedEvent = listed[0] as { sequence: number; payload: { text: string } }
    listedEvent.sequence = 99
    listedEvent.payload.text = 'mutated list output'
    listed.push(listed[0])
    listed.reverse()

    const stored = log.list(runId)
    expect(stored).toHaveLength(1)
    expect(stored[0].sequence).toBe(1)
    const storedEvent = stored[0] as { sequence: number; payload: { text: string } }
    expect(storedEvent.payload.text).toBe('original')
  })

  it('allows valid tool started-to-completed and approval requested-to-resolved transitions', () => {
    const log = new InMemoryAgentEventLog()

    log.append({
      type: 'tool.started',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', toolName: 'search' },
    })
    log.append({
      type: 'tool.completed',
      runId,
      conversationId,
      payload: { toolCallId: 'tool-1', toolName: 'search', summary: 'Found results' },
    })
    log.append({
      type: 'approval.requested',
      runId,
      conversationId,
      payload: { approvalId: 'approval-1', planId: 'plan-1', summary: 'Approve plan' },
    })
    log.append({
      type: 'approval.resolved',
      runId,
      conversationId,
      payload: { approvalId: 'approval-1', decision: 'edited' },
    })

    expect(log.list(runId).map(event => event.type)).toEqual([
      'tool.started',
      'tool.completed',
      'approval.requested',
      'approval.resolved',
    ])
  })
})
