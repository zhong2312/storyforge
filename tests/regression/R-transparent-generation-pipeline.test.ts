import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../src/lib/types'
import {
  createOutlineWorkshopNodes,
  OUTLINE_WORKSHOP_NODE_IDS,
  runGenerationNode,
  type GenerationNode,
  type OutlineWorkshopContext,
} from '../../src/lib/generation-pipeline'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

function workshopContext(overrides: Partial<OutlineWorkshopContext> = {}): OutlineWorkshopContext {
  return {
    projectId: 1,
    projectName: '透明流水线测试',
    genre: '玄幻',
    worldGroupId: null,
    volumeId: 10,
    volumeTitle: '第一卷',
    volumeSummary: '主角发现飞升骗局。',
    chapterCount: 12,
    userHint: '',
    provider: 'custom',
    model: 'test-model',
    artifacts: {},
    generate: vi.fn(async () => '生成结果'),
    assemble: vi.fn(async input => ({
      text: input.manualSourceText || '项目上下文',
      segments: [],
      included: input.sourceKeys || [],
      omitted: [],
      trimmed: [],
      totalInputTokens: 10,
      inputBudget: 1000,
      overBudgetBeforeTrim: false,
      overBudgetAfterTrim: false,
    })),
    ...overrides,
  }
}

describe('R-TRANSPARENT-PIPELINE · 透明生成流水线', () => {
  it('未启用编辑时保持原输入行为', async () => {
    const input: ChatMessage[] = [{ role: 'user', content: '原始提示词' }]
    const run = vi.fn(async (messages: ChatMessage[]) => messages[0].content)
    const node: GenerationNode<object, ChatMessage[], string> = {
      id: 'single', label: '单节点', description: '', editableInput: false,
      assembleInput: async () => input,
      run,
    }

    const result = await runGenerationNode(node, {}, {
      editInput: async () => [{ role: 'user', content: '不应生效' }],
    })

    expect(result?.output).toBe('原始提示词')
    expect(run).toHaveBeenCalledWith(input, {})
  })

  it('发送的是编辑后输入，并且一次性覆盖不污染原消息', async () => {
    const original: ChatMessage[] = [
      { role: 'system', content: '原系统提示词' },
      { role: 'user', content: '原用户提示词' },
    ]
    const run = vi.fn(async (messages: ChatMessage[]) => messages[1].content)
    const node: GenerationNode<object, ChatMessage[], string> = {
      id: 'editable', label: '可编辑节点', description: '', editableInput: true,
      assembleInput: async () => original,
      run,
    }

    const result = await runGenerationNode(node, {}, {
      editInput: async messages => {
        messages[1].content = '编辑后用户提示词'
        return messages
      },
    })

    expect(result?.output).toBe('编辑后用户提示词')
    expect(run.mock.calls[0][0][1].content).toBe('编辑后用户提示词')
    expect(original[1].content).toBe('原用户提示词')
  })

  it('章纲工坊固定为五节点且不能在前序未确认时越级', async () => {
    const nodes = createOutlineWorkshopNodes()
    expect(nodes.map(node => node.id)).toEqual(OUTLINE_WORKSHOP_NODE_IDS)
    expect(nodes.map(node => node.label)).toEqual(['现状扫描', '动机推演', '碰撞预演', '质检闸门', '正式章纲'])

    await expect(nodes[1].assembleInput(workshopContext())).rejects.toThrow('请先确认前序阶段：现状扫描')
    await expect(nodes[4].assembleInput(workshopContext({ artifacts: { scan: '已确认扫描' } })))
      .rejects.toThrow('动机推演、碰撞预演、质检闸门')
  })

  it('后续节点通过 manualText 注册源收到所有已确认阶段产物', async () => {
    const assemble = vi.fn(async input => ({
      text: input.manualSourceText || '',
      segments: [], included: input.sourceKeys || [], omitted: [], trimmed: [],
      totalInputTokens: 10, inputBudget: 1000,
      overBudgetBeforeTrim: false, overBudgetAfterTrim: false,
    }))
    const context = workshopContext({
      artifacts: {
        scan: '扫描锚点 A',
        motivation: '动机锚点 B',
      },
      assemble,
    })
    const messages = await createOutlineWorkshopNodes()[2].assembleInput(context)
    const assembledInput = assemble.mock.calls[0][0]

    expect(assembledInput.sourceKeys).toContain('manualText')
    expect(assembledInput.manualSourceText).toContain('扫描锚点 A')
    expect(assembledInput.manualSourceText).toContain('动机锚点 B')
    expect(messages[1].content).toContain('扫描锚点 A')
    expect(messages[1].content).toContain('动机锚点 B')
  })

  it('最终节点要求输出可直接采纳的固定数量 JSON 章纲', async () => {
    const messages = await createOutlineWorkshopNodes()[4].assembleInput(workshopContext({
      artifacts: {
        scan: '扫描', motivation: '动机', collision: '碰撞', quality: '质检',
      },
    }))
    const prompt = messages.map(message => message.content).join('\n')

    expect(prompt).toContain('只输出合法 JSON 数组')
    expect(prompt).toContain('必须恰好生成指定章节数')
    expect(prompt).toContain('不可写清单')
    expect(prompt).toContain('【目标章节数】12')
  })

  it('界面保留快速入口并新增工坊，Agent 透明开关默认关闭', () => {
    const outline = source('src/components/outline/OutlinePanel.tsx')
    const dock = source('src/components/agent/AgentDock.tsx')
    const preview = source('src/components/shared/PromptPreviewGate.tsx')

    expect(outline).toContain('Agent 生成本卷章节')
    expect(outline).toContain('章纲工坊')
    expect(outline).toContain('<OutlineWorkshopDialog')
    expect(dock).toContain("localStorage.getItem(AGENT_TRANSPARENT_PROMPT_PREVIEW_KEY) === 'true'")
    expect(dock).toContain('发送前预览提示词')
    expect(dock).toContain('<PromptPreviewGate')
    expect(preview).toContain('不会写回提示词库或项目设定')
  })
})
