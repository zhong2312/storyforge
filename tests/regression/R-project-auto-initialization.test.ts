import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createProjectInitializationPlan,
  remainingInitializationSteps,
} from '../../src/services/project-initialization-runner'
import {
  completedInitializationStepIds,
  mergeInitializationItems,
  PROJECT_INITIALIZATION_STORAGE_KEY,
  useProjectInitializationStore,
} from '../../src/stores/project-initialization'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import type { Project } from '../../src/lib/types'

const project: Project = {
  id: 1,
  name: '初始化测试',
  genre: '玄幻',
  description: '',
  targetWordCount: 1_000_000,
  createdAt: 1,
  updatedAt: 1,
}

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('R-PROJECT-INIT · 全自动项目初始化', () => {
  it('清单完整覆盖三大块，角色数量支持 10-30', () => {
    const minimum = createProjectInitializationPlan({
      project, idea: '少年反抗飞升骗局', characterCount: 10, worldGroupId: null,
    })
    const maximum = createProjectInitializationPlan({
      project, idea: '少年反抗飞升骗局', characterCount: 30, worldGroupId: null,
    })

    expect(new Set(minimum.items.map(item => item.group))).toEqual(new Set(['worldview', 'story', 'characters']))
    expect(minimum.items.filter(item => item.group === 'characters')).toHaveLength(10)
    expect(maximum.items.filter(item => item.group === 'characters')).toHaveLength(30)
    expect(minimum.items.map(item => item.label)).toEqual(expect.arrayContaining([
      '真实与幻想规则', '世界来源', '力量体系', '神明与信仰', '世界结构',
      '世界历史线', '世界地图', '一句话故事', '核心冲突', '故事主线', '角色 01', '角色 10',
    ]))
  })

  it('每个后台步骤只使用已登记的上下文源和写回目标', () => {
    const plan = createProjectInitializationPlan({
      project, idea: '少年反抗飞升骗局', characterCount: 12, worldGroupId: null,
    })
    for (const step of plan.steps) {
      expect(FIELD_BY_TARGET.has(step.completionRequirement.target), step.id).toBe(true)
      for (const sourceKey of step.completionRequirement.requiredContextSources ?? []) {
        expect(CONTEXT_SOURCE_BY_KEY.has(sourceKey), `${step.id}:${sourceKey}`).toBe(true)
      }
    }
  })

  it('后台执行复用 Agent 工具链并自动批准已授权清单，不走旧 AI 流', () => {
    const runner = source('src/services/project-initialization-runner.ts')
    const runtimeFactory = source('src/lib/agent/runtime/project-agent-runtime.ts')
    const store = source('src/stores/project-initialization.ts')

    expect(runner).toContain('createProjectAgentRuntime')
    expect(runner).toContain("decision: 'approved'")
    expect(runner).toContain("toolName === 'storyforge.change.commit'")
    expect(runtimeFactory).toContain('createStoryForgeTools')
    expect(runtimeFactory).toContain('AdoptionPlanStore')
    expect(store).toContain('activeRunner')
    expect(store).toContain('runnerLaunchPending')
    expect(store).toContain('persist((set, get)')
    expect(store).toContain('completedInitializationStepIds')
    for (const content of [runner, store]) {
      expect(content).not.toContain('useAIStream')
      expect(content).not.toContain('streamChat')
      expect(content).not.toContain('chat(')
      expect(content).not.toContain('db.')
    }
  })

  it('弹窗由 Workspace 托管，关闭项目概况或切换菜单不会卸载任务 Store', () => {
    const workspace = source('src/pages/WorkspacePage.tsx')
    const projectInfo = source('src/components/project/ProjectInfoPanel.tsx')
    const dialog = source('src/components/project/ProjectInitializationDialog.tsx')

    expect(projectInfo).toContain("'AI 初始化'")
    expect(workspace).toContain('<ProjectInitializationDialog')
    expect(workspace).toContain('<ProjectInitializationProgressIndicator')
    expect(dialog).toContain('关闭窗口或切换菜单不会中断任务')
    expect(dialog).toContain('故事大概思路')
    expect(dialog).toContain('初始化角色数量')
    expect(workspace).toContain("initializationTask.status === 'running'")
    expect(workspace).toContain('.resume({')
    expect(dialog).toContain('确认重新初始化项目？')
    expect(dialog).toContain('继续未完成任务')
  })

  it('恢复执行时保留逐项完成状态并跳过已完成步骤', () => {
    const plan = createProjectInitializationPlan({
      project, idea: '少年反抗飞升骗局', characterCount: 12, worldGroupId: null,
    })
    const completedStepId = plan.steps[0].id
    const savedItems = plan.items.map(item => item.stepId === completedStepId
      ? { ...item, status: 'completed' as const }
      : item)
    const completedStepIds = completedInitializationStepIds(savedItems)
    const remaining = remainingInitializationSteps(plan.steps, completedStepIds)
    const merged = mergeInitializationItems(plan.items, savedItems)

    expect(completedStepIds).toEqual(new Set([completedStepId]))
    expect(remaining.some(step => step.id === completedStepId)).toBe(false)
    expect(merged.filter(item => item.stepId === completedStepId).every(item => item.status === 'completed')).toBe(true)
  })

  it('每次任务状态更新都持久化可恢复快照', () => {
    localStorage.removeItem(PROJECT_INITIALIZATION_STORAGE_KEY)
    const plan = createProjectInitializationPlan({
      project, idea: '少年反抗飞升骗局', characterCount: 10, worldGroupId: null,
    })
    useProjectInitializationStore.setState({
      task: {
        projectId: 1,
        projectName: project.name,
        idea: '少年反抗飞升骗局',
        characterCount: 10,
        worldGroupId: null,
        status: 'running',
        items: [{ ...plan.items[0], status: 'completed' }, ...plan.items.slice(1)],
        startedAt: Date.now(),
      },
    })

    const persisted = JSON.parse(localStorage.getItem(PROJECT_INITIALIZATION_STORAGE_KEY) || '{}')
    expect(persisted.state.task.items[0].status).toBe('completed')
    expect(persisted.state.task.idea).toBe('少年反抗飞升骗局')

    useProjectInitializationStore.setState({ task: null })
    localStorage.removeItem(PROJECT_INITIALIZATION_STORAGE_KEY)
  })
})
