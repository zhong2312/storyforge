import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Project } from '../lib/types'
import type { ProjectInitializationItem } from '../services/project-initialization-runner'

export const PROJECT_INITIALIZATION_STORAGE_KEY = 'storyforge-project-initialization-v1'

export type ProjectInitializationStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ProjectInitializationTask {
  projectId: number
  projectName: string
  idea: string
  characterCount: number
  worldGroupId: number | null
  status: ProjectInitializationStatus
  items: ProjectInitializationItem[]
  currentStepId?: string
  currentStepLabel?: string
  detail?: string
  error?: string
  startedAt: number
  completedAt?: number
}

interface StartInput {
  project: Project
  idea: string
  characterCount: number
  worldGroupId: number | null
  onCommit: () => void | Promise<void>
}

interface ResumeInput {
  project: Project
  onCommit: () => void | Promise<void>
}

interface ProjectInitializationStore {
  task: ProjectInitializationTask | null
  start: (input: StartInput) => void
  resume: (input: ResumeInput) => void
  cancel: () => Promise<void>
  clear: () => void
}

let activeRunner: { cancel: () => Promise<void> } | null = null
let runnerLaunchPending = false

export const useProjectInitializationStore = create<ProjectInitializationStore>()(persist((set, get) => ({
  task: null,

  start: input => {
    if (!input.project.id || get().task?.status === 'running' || activeRunner || runnerLaunchPending) return
    const characterCount = Math.max(10, Math.min(30, Math.round(input.characterCount)))
    set({
      task: {
        projectId: input.project.id,
        projectName: input.project.name,
        idea: input.idea.trim(),
        characterCount,
        worldGroupId: input.worldGroupId,
        status: 'running',
        items: [],
        detail: '正在加载初始化 Agent',
        startedAt: Date.now(),
      },
    })
    void launchRunner(input, characterCount, new Set(), set, get)
  },

  resume: input => {
    const task = get().task
    if (!input.project.id || !task || task.projectId !== input.project.id || task.status === 'completed' || activeRunner || runnerLaunchPending) return
    const completedStepIds = completedInitializationStepIds(task.items)
    set({
      task: {
        ...task,
        status: 'running',
        currentStepId: undefined,
        currentStepLabel: undefined,
        detail: '正在恢复初始化任务',
        error: undefined,
        completedAt: undefined,
        items: task.items.map(item => item.status === 'completed'
          ? item
          : { ...item, status: 'pending', error: undefined }),
      },
    })
    void launchRunner({
      project: input.project,
      idea: task.idea,
      characterCount: task.characterCount,
      worldGroupId: task.worldGroupId,
      onCommit: input.onCommit,
    }, task.characterCount, completedStepIds, set, get)
  },

  cancel: async () => {
    await activeRunner?.cancel()
    set(state => ({
      task: state.task ? {
        ...state.task,
        status: 'cancelled',
        detail: '正在停止初始化任务',
        completedAt: Date.now(),
      } : null,
    }))
  },

  clear: () => {
    if (get().task?.status === 'running') return
    set({ task: null })
  },
}), {
  name: PROJECT_INITIALIZATION_STORAGE_KEY,
  storage: createJSONStorage(() => localStorage),
  partialize: state => ({ task: state.task }),
  merge: (persistedState, currentState) => ({
    ...currentState,
    task: normalizePersistedTask((persistedState as Partial<ProjectInitializationStore>)?.task),
  }),
}))

type StoreSet = (updater: (state: ProjectInitializationStore) => Partial<ProjectInitializationStore>) => void
type StoreGet = () => ProjectInitializationStore

async function launchRunner(
  input: StartInput,
  characterCount: number,
  completedStepIds: ReadonlySet<string>,
  set: StoreSet,
  get: StoreGet,
): Promise<void> {
  if (activeRunner || runnerLaunchPending) return
  runnerLaunchPending = true
  try {
    const { ProjectInitializationRunner } = await import('../services/project-initialization-runner')
    if (get().task?.status !== 'running' || get().task?.projectId !== input.project.id) return
    const runner = new ProjectInitializationRunner(
      { ...input, characterCount },
      {
        onStepStarted: step => set(state => ({
          task: state.task ? {
            ...state.task,
            currentStepId: step.id,
            currentStepLabel: step.label,
            detail: '正在准备 Agent',
            items: patchStepItems(state.task.items, step.id, 'running'),
          } : null,
        })),
        onStepProgress: (step, detail) => set(state => ({
          task: state.task ? {
            ...state.task,
            currentStepId: step.id,
            currentStepLabel: step.label,
            detail,
          } : null,
        })),
        onStepCompleted: step => set(state => ({
          task: state.task ? {
            ...state.task,
            detail: `${step.label}已写入`,
            items: patchStepItems(state.task.items, step.id, 'completed'),
          } : null,
        })),
        onStepFailed: (step, error) => set(state => ({
          task: state.task ? {
            ...state.task,
            detail: error,
            items: patchStepItems(state.task.items, step.id, 'failed', error),
          } : null,
        })),
        onCommit: input.onCommit,
      },
      { completedStepIds },
    )
    activeRunner = runner
    set(state => ({
      task: state.task ? {
        ...state.task,
        items: mergeInitializationItems(runner.plan.items, state.task.items),
        detail: '初始化任务已进入后台队列',
      } : null,
    }))
    await runner.run()
    set(state => ({
      task: state.task ? {
        ...state.task,
        status: 'completed',
        currentStepId: undefined,
        currentStepLabel: undefined,
        detail: '项目初始化完成',
        completedAt: Date.now(),
      } : null,
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    set(state => ({
      task: state.task ? {
        ...state.task,
        status: message === '初始化任务已停止' ? 'cancelled' : 'failed',
        error: message,
        detail: message,
        completedAt: Date.now(),
      } : null,
    }))
  } finally {
    activeRunner = null
    runnerLaunchPending = false
  }
}

export function completedInitializationStepIds(items: readonly ProjectInitializationItem[]): Set<string> {
  const statuses = new Map<string, boolean>()
  for (const item of items) {
    statuses.set(item.stepId, (statuses.get(item.stepId) ?? true) && item.status === 'completed')
  }
  return new Set([...statuses].filter(([, completed]) => completed).map(([stepId]) => stepId))
}

export function mergeInitializationItems(
  planItems: readonly ProjectInitializationItem[],
  savedItems: readonly ProjectInitializationItem[],
): ProjectInitializationItem[] {
  const savedById = new Map(savedItems.map(item => [item.id, item]))
  return planItems.map(item => {
    const saved = savedById.get(item.id)
    return saved?.status === 'completed' ? { ...item, status: 'completed' } : item
  })
}

function normalizePersistedTask(task: ProjectInitializationTask | null | undefined): ProjectInitializationTask | null {
  if (!task || !Number.isFinite(task.projectId) || !Array.isArray(task.items)) return null
  if (task.status !== 'running') return task
  return {
    ...task,
    currentStepId: undefined,
    currentStepLabel: undefined,
    detail: '检测到上次未完成的初始化任务，正在等待恢复',
    items: task.items.map(item => item.status === 'running'
      ? { ...item, status: 'pending', error: undefined }
      : item),
  }
}

function patchStepItems(
  items: ProjectInitializationItem[],
  stepId: string,
  status: ProjectInitializationItem['status'],
  error?: string,
): ProjectInitializationItem[] {
  return items.map(item => item.stepId === stepId ? { ...item, status, error } : item)
}

export function projectInitializationProgress(task: ProjectInitializationTask | null): {
  completed: number
  total: number
  percent: number
} {
  const total = task?.items.length ?? 0
  const completed = task?.items.filter(item => item.status === 'completed').length ?? 0
  return { completed, total, percent: total ? Math.round(completed / total * 100) : 0 }
}
