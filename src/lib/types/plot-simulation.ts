import type { AIModelRef } from './ai'

export type PlotSimulationStatus = 'draft' | 'running' | 'completed' | 'failed'

export interface PlotSimulationCharacterAction {
  characterId: number
  characterName: string
  intent: string
  action: string
  dialogue: string
  innerThought: string
  stateChange: string
  modelRef: AIModelRef
}

export interface PlotSimulationWorldState {
  pressure: string
  events: string[]
  constraints: string[]
}

export interface PlotSimulationTurn {
  id?: number
  projectId: number
  sessionId: number
  turnNumber: number
  worldState: PlotSimulationWorldState
  characterActions: PlotSimulationCharacterAction[]
  narration: string
  summary: string
  worldChanges: string[]
  unresolvedHooks: string[]
  createdAt: number
  updatedAt: number
}

export interface PlotSimulationSession {
  id?: number
  projectId: number
  sessionKey: string
  title: string
  premise: string
  goal: string
  status: PlotSimulationStatus
  worldGroupId?: number | null
  chapterId?: number | null
  selectedCharacterIds: number[]
  narratorModelRef?: AIModelRef | null
  defaultCharacterModelRef?: AIModelRef | null
  plannedTurns: number
  currentTurn: number
  error?: string
  createdAt: number
  updatedAt: number
}
