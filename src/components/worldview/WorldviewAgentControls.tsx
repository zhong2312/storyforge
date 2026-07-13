import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { Project } from '../../lib/types'
import type { FieldGenerationMode } from '../../lib/ai/field-generation-context'
import { dispatchAgentIntent } from '../../lib/agent/intents'
import AIFieldModeTabs from '../shared/AIFieldModeTabs'

const MODE_INSTRUCTIONS: Record<FieldGenerationMode, string> = {
  expand: '保留当前设定中的事实、方向和关键措辞，在此基础上补全、扩写和细化。',
  rewrite: '根据项目事实重新生成完整内容，可以替换当前版本，但不得破坏其他既有设定。',
  polish: '优化表达、结构和可读性，除非用户明确要求，不新增重大设定。',
}

const WORLDVIEW_CONTEXT_SOURCES = [
  'worldRules',
  'worldview',
  'storyCore',
  'characters',
  'storyArcs',
  'historical',
  'codex',
  'creativeRules',
] as const

interface Props {
  project: Project
  module: 'worldview-origin' | 'worldview-natural' | 'worldview-humanity'
  field: string
  label: string
  currentValue: unknown
  worldGroupId: number | null
}

export default function WorldviewAgentControls({
  project,
  module,
  field,
  label,
  currentValue,
  worldGroupId,
}: Props) {
  const [hint, setHint] = useState('')
  const [mode, setMode] = useState<FieldGenerationMode>('expand')

  const handleGenerate = () => {
    dispatchAgentIntent({
      type: `worldview.${field}`,
      title: `Agent 完善 · ${label}`,
      promptModuleKey: 'worldview.dimension',
      source: {
        project: { backend: 'dexie', projectId: project.id! },
        module,
        field,
        worldGroupId,
      },
      instruction: [
        `为“世界观 / ${label}”生成可直接写入项目的正式设定内容。`,
        MODE_INSTRUCTIONS[mode],
        '先通过项目工具读取世界规则、当前世界观、故事核心、角色、故事线、历史年表、相关词条和创作规则，再检查设定之间是否自洽。',
        `最终必须调用 storyforge.change.propose，使用 target=worldviews、mode=replace，且 data 只能包含字段 ${field}。`,
        `不要只输出建议、提问或分析；审批方案中必须给出完整的“${label}”正式内容。`,
        hint.trim() ? `用户补充要求：${hint.trim()}` : '',
      ].filter(Boolean).join('\n'),
      completionRequirement: {
        kind: 'change-proposal',
        target: 'worldviews',
        mode: 'replace',
        requiredFields: [field],
        requiredDataPaths: [[field]],
        requiredContextSources: WORLDVIEW_CONTEXT_SOURCES,
        deliverableKind: 'structured-record',
      },
      payload: {
        projectName: project.name,
        genres: project.genre || '',
        dimension: label,
        worldContext: '以项目工具读取到的当前世界观、角色、故事线、历史和词条为准。',
        worldRulesContext: '严格遵守项目工具读取到的“真实与幻想”规则。',
        targetField: field,
        fieldLabel: label,
        generationMode: mode,
        currentValue,
        userHint: hint.trim(),
      },
    })
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <AIFieldModeTabs value={mode} onChange={setMode} />
      <input
        value={hint}
        onChange={event => setHint(event.target.value)}
        placeholder="给 Agent 的补充说明（可选）"
        className="flex-1 rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
      />
      <button
        type="button"
        onClick={handleGenerate}
        className="flex shrink-0 items-center gap-1.5 rounded bg-accent/10 px-3 py-1.5 text-xs text-accent hover:bg-accent/20"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Agent 生成
      </button>
    </div>
  )
}
