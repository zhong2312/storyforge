import type { AgentEvent } from '../events/agent-events'

export interface AgentTimelineTextItem {
  readonly kind: 'message' | 'reasoning' | 'summary'
  readonly id: string
  readonly sequence: number
  text: string
}

export interface AgentTimelineToolItem {
  readonly kind: 'tool'
  readonly id: string
  readonly sequence: number
  readonly toolCallId: string
  readonly name: string
  summary: string
  status: 'running' | 'completed' | 'failed'
  result?: string
}

export type AgentTimelineItem = AgentTimelineTextItem | AgentTimelineToolItem

export interface AgentTimelinePhase {
  readonly id: string
  readonly phase: string
  readonly label: string
  status: 'running' | 'completed' | 'failed'
  readonly startedAt: number
  completedAt?: number
  readonly items: AgentTimelineItem[]
}

export interface AgentTimelineMessage {
  readonly id: string
  readonly sequence: number
  readonly text: string
}

export interface AgentTurnTimeline {
  readonly phases: AgentTimelinePhase[]
  readonly finalMessages: AgentTimelineMessage[]
}

export function collectAgentTurnTimeline(events: readonly AgentEvent[]): AgentTurnTimeline {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence)
  const phases: AgentTimelinePhase[] = []
  const finalMessages: AgentTimelineMessage[] = []
  const streamedMessages: string[] = []
  const streamedReasoning: string[] = []
  let current: AgentTimelinePhase | undefined

  const ensurePhase = (event: AgentEvent): AgentTimelinePhase => {
    if (current) return current
    current = {
      id: `implicit-${event.runId}-${phases.length + 1}`,
      phase: `implicit-${phases.length + 1}`,
      label: `阶段 ${phases.length + 1}`,
      status: 'running',
      startedAt: event.timestamp,
      items: [],
    }
    phases.push(current)
    return current
  }

  for (const event of ordered) {
    if (event.type === 'phase.started') {
      if (current?.status === 'running') {
        current.status = 'completed'
        current.completedAt = event.timestamp
      }
      current = {
        id: `${event.runId}-${event.payload.phase}-${event.sequence}`,
        phase: event.payload.phase,
        label: event.payload.label,
        status: 'running',
        startedAt: event.timestamp,
        items: [],
      }
      phases.push(current)
      continue
    }

    if (event.type === 'phase.completed') {
      const phase = [...phases].reverse().find(item => item.phase === event.payload.phase)
        ?? ensurePhase(event)
      if (event.payload.summary) appendTextItem(phase, 'summary', event, event.payload.summary)
      phase.status = 'completed'
      phase.completedAt = event.timestamp
      current = phase
      continue
    }

    if (event.type === 'message.delta') {
      streamedMessages.push(event.payload.text)
      appendTextItem(ensurePhase(event), 'message', event, event.payload.text)
      continue
    }

    if (event.type === 'message.completed') {
      if (event.payload.text !== streamedMessages.join('')) {
        finalMessages.push({ id: event.id, sequence: event.sequence, text: event.payload.text })
      }
      continue
    }

    if (event.type === 'reasoning.summary.delta') {
      streamedReasoning.push(event.payload.text)
      appendTextItem(ensurePhase(event), 'reasoning', event, event.payload.text)
      continue
    }

    if (event.type === 'reasoning.summary.completed') {
      if (event.payload.text !== streamedReasoning.join('')) {
        appendTextItem(ensurePhase(event), 'reasoning', event, event.payload.text)
      }
      continue
    }

    if (event.type === 'tool.requested') {
      ensurePhase(event).items.push({
        kind: 'tool',
        id: event.id,
        sequence: event.sequence,
        toolCallId: event.payload.toolCallId,
        name: event.payload.toolName,
        summary: event.payload.summary,
        status: 'running',
      })
      continue
    }

    if (event.type === 'tool.started') {
      if (!findTool(phases, event.payload.toolCallId)) {
        ensurePhase(event).items.push({
          kind: 'tool',
          id: event.id,
          sequence: event.sequence,
          toolCallId: event.payload.toolCallId,
          name: event.payload.toolName,
          summary: event.payload.toolName,
          status: 'running',
        })
      }
      continue
    }

    if (event.type === 'tool.progress') {
      const match = findTool(phases, event.payload.toolCallId)
      if (match) match.tool.result = event.payload.message
      continue
    }

    if (event.type === 'tool.completed' || event.type === 'tool.failed') {
      const match = findTool(phases, event.payload.toolCallId)
      const phase = match?.phase ?? ensurePhase(event)
      const tool = match?.tool ?? {
        kind: 'tool' as const,
        id: event.id,
        sequence: event.sequence,
        toolCallId: event.payload.toolCallId,
        name: event.payload.toolName,
        summary: event.payload.toolName,
        status: 'running' as const,
      }
      if (!match) phase.items.push(tool)
      tool.status = event.type === 'tool.completed' ? 'completed' : 'failed'
      tool.result = event.type === 'tool.completed' ? event.payload.summary : event.payload.error
      if (event.type === 'tool.failed') {
        phase.status = 'failed'
        phase.completedAt = event.timestamp
      }
      continue
    }

    if (event.type === 'run.failed' || event.type === 'run.cancelled') {
      const phase = ensurePhase(event)
      phase.status = 'failed'
      phase.completedAt = event.timestamp
    } else if (event.type === 'run.completed' && current?.status === 'running') {
      current.status = 'completed'
      current.completedAt = event.timestamp
    }
  }

  return { phases, finalMessages }
}

function appendTextItem(
  phase: AgentTimelinePhase,
  kind: AgentTimelineTextItem['kind'],
  event: AgentEvent,
  text: string,
): void {
  if (!text) return
  const previous = phase.items[phase.items.length - 1]
  if (previous?.kind === kind) {
    previous.text += text
    return
  }
  phase.items.push({ kind, id: event.id, sequence: event.sequence, text })
}

function findTool(
  phases: readonly AgentTimelinePhase[],
  toolCallId: string,
): { phase: AgentTimelinePhase; tool: AgentTimelineToolItem } | undefined {
  for (const phase of phases) {
    const tool = phase.items.find((item): item is AgentTimelineToolItem => (
      item.kind === 'tool' && item.toolCallId === toolCallId
    ))
    if (tool) return { phase, tool }
  }
  return undefined
}
