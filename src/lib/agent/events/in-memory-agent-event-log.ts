import { nanoid } from 'nanoid'
import {
  type AgentEvent,
  type NewAgentEvent,
  isTerminalAgentEvent,
} from './agent-events'

type FreezableObject = Record<PropertyKey, unknown>

type ToolState =
  | { readonly status: 'idle' }
  | { readonly status: 'started'; readonly toolName: string }
  | { readonly status: 'completed'; readonly toolName: string }
  | { readonly status: 'failed'; readonly toolName: string }

type ApprovalState = 'idle' | 'pending' | 'resolved'

function isFreezableObject(value: unknown): value is FreezableObject {
  return typeof value === 'object' && value !== null
}

function cloneEvent<Event>(event: Event): Event {
  return structuredClone(event)
}

function deepFreeze<Event>(event: Event): Event {
  if (!isFreezableObject(event) || Object.isFrozen(event)) {
    return event
  }

  for (const key of Reflect.ownKeys(event)) {
    deepFreeze(event[key])
  }

  return Object.freeze(event) as Event
}

export class InMemoryAgentEventLog {
  private readonly eventsByRunId = new Map<string, readonly AgentEvent[]>()

  append(input: NewAgentEvent): AgentEvent {
    const existingEvents = this.eventsByRunId.get(input.runId) ?? []

    this.assertConversationBinding(input, existingEvents)

    if (existingEvents.some(isTerminalAgentEvent)) {
      throw new Error(`[agent-events] ${input.runId} is already terminal`)
    }

    this.assertToolTransition(input, existingEvents)
    this.assertApprovalTransition(input, existingEvents)

    const event = deepFreeze({
      ...cloneEvent(input),
      id: nanoid(),
      sequence: existingEvents.length + 1,
      timestamp: Date.now(),
    } as AgentEvent)

    this.eventsByRunId.set(input.runId, [...existingEvents, event])

    return cloneEvent(event)
  }

  list(runId: string): AgentEvent[] {
    return (this.eventsByRunId.get(runId) ?? []).map(event => cloneEvent(event))
  }

  private assertConversationBinding(input: NewAgentEvent, existingEvents: readonly AgentEvent[]): void {
    const boundConversationId = existingEvents[0]?.conversationId

    if (boundConversationId !== undefined && boundConversationId !== input.conversationId) {
      throw new Error(`[agent-events] ${input.runId} conversation mismatch`)
    }
  }

  private assertToolTransition(input: NewAgentEvent, existingEvents: readonly AgentEvent[]): void {
    if (input.type === 'tool.started') {
      const state = this.getToolState(input.payload.toolCallId, existingEvents)

      if (state.status === 'started') {
        throw new Error(`tool ${input.payload.toolCallId} duplicate started`)
      }

      if (state.status === 'completed' || state.status === 'failed') {
        throw new Error(`tool ${input.payload.toolCallId} is already terminal`)
      }

      return
    }

    if (input.type === 'tool.progress') {
      const state = this.getToolState(input.payload.toolCallId, existingEvents)
      this.assertToolIsActive(input.payload.toolCallId, state)
      return
    }

    if (input.type !== 'tool.completed' && input.type !== 'tool.failed') {
      return
    }

    const { toolCallId, toolName } = input.payload
    const state = this.getToolState(toolCallId, existingEvents)
    this.assertToolIsActive(toolCallId, state)

    if (state.status === 'started' && state.toolName !== toolName) {
      throw new Error(`tool ${toolCallId} tool name mismatch`)
    }
  }

  private assertToolIsActive(toolCallId: string, state: ToolState): asserts state is Extract<ToolState, { readonly status: 'started' }> {
    if (state.status === 'idle') {
      throw new Error(`tool ${toolCallId} has not started`)
    }

    if (state.status === 'completed' || state.status === 'failed') {
      throw new Error(`tool ${toolCallId} is already terminal`)
    }
  }

  private getToolState(toolCallId: string, existingEvents: readonly AgentEvent[]): ToolState {
    let state: ToolState = { status: 'idle' }

    for (const event of existingEvents) {
      if (event.type === 'tool.started' && event.payload.toolCallId === toolCallId) {
        state = { status: 'started', toolName: event.payload.toolName }
      } else if (event.type === 'tool.completed' && event.payload.toolCallId === toolCallId) {
        state = { status: 'completed', toolName: event.payload.toolName }
      } else if (event.type === 'tool.failed' && event.payload.toolCallId === toolCallId) {
        state = { status: 'failed', toolName: event.payload.toolName }
      }
    }

    return state
  }

  private assertApprovalTransition(input: NewAgentEvent, existingEvents: readonly AgentEvent[]): void {
    if (input.type === 'approval.requested') {
      const state = this.getApprovalState(input.payload.approvalId, existingEvents)

      if (state !== 'idle') {
        throw new Error(`approval ${input.payload.approvalId} duplicate requested`)
      }

      return
    }

    if (input.type !== 'approval.resolved') {
      return
    }

    const { approvalId } = input.payload
    const state = this.getApprovalState(approvalId, existingEvents)

    if (state !== 'pending') {
      throw new Error(`approval ${approvalId} is not pending`)
    }
  }

  private getApprovalState(approvalId: string, existingEvents: readonly AgentEvent[]): ApprovalState {
    let state: ApprovalState = 'idle'

    for (const event of existingEvents) {
      if (event.type === 'approval.requested' && event.payload.approvalId === approvalId) {
        state = 'pending'
      } else if (event.type === 'approval.resolved' && event.payload.approvalId === approvalId) {
        state = 'resolved'
      }
    }

    return state
  }
}
