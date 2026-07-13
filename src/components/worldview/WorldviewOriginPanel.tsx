import { useState, useEffect, type ReactNode } from 'react'
import { useWorldviewStore } from '../../stores/worldview'
import { useWorldGroupStore } from '../../stores/world-group'
import WorldGroupSwitcher from '../world-group/WorldGroupSwitcher'
import CodexPanel from '../codex/CodexPanel'
import CodexSearchBar from '../codex/CodexSearchBar'
import MarkdownFieldEditor from '../shared/MarkdownFieldEditor'
import WorldviewCodexSection from '../shared/WorldviewCodexSection'
import WorldviewEditorTabs from '../shared/WorldviewEditorTabs'
import WorldviewAgentControls from './WorldviewAgentControls'
import type { Project, DivineDesign } from '../../lib/types'

// ── 常量 ───────────────────────────────────────────────────────

type FieldKey = 'origin' | 'power' | 'divine'

const FIELDS: { key: FieldKey; label: string; icon: string; desc: string }[] = [
  { key: 'origin', label: '世界来源', icon: '🌌', desc: '创世神话 / 历史时期 / 文明起源……世界从何而来？' },
  { key: 'power',  label: '力量体系', icon: '⚡', desc: '修真等级 / 社会等级 / 科技层级……力量如何分层、怎么晋升？' },
  { key: 'divine', label: '神明与信仰', icon: '🌟', desc: '是否存在神明或宗教？神明 / 信仰的层级、名号、规则与限制。' },
]

interface Props {
  project: Project
}

// ── 主面板 ─────────────────────────────────────────────────────

/** v3 §2.1 — 世界观.世界起源（三个子模块） */
export default function WorldviewOriginPanel({ project }: Props) {
  const { worldview, saveWorldview, loadAll } = useWorldviewStore()
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)

  const [active, setActive] = useState<FieldKey>('origin')
  const [worldOrigin, setWorldOrigin] = useState('')
  const [powerHierarchy, setPowerHierarchy] = useState('')
  const [divineDesign, setDivineDesign] = useState<DivineDesign>({
    hasDivinity: false,
    divineRank: '',
    divineNames: '',
    divineRules: '',
  })

  // 多世界模式下按当前世界组加载，单世界传 null 走原逻辑
  useEffect(() => {
    loadAll(project.id!, project.enableMultiWorld ? activeGroupId : null)
  }, [project.id, project.enableMultiWorld, activeGroupId, loadAll])

  // 同步 store -> 本地 state
  useEffect(() => {
    if (!worldview) return
    setWorldOrigin(worldview.worldOrigin || '')
    setPowerHierarchy(worldview.powerHierarchy || '')
    setDivineDesign(worldview.divineDesign || {
      hasDivinity: false, divineRank: '', divineNames: '', divineRules: '',
    })
  }, [worldview])

  // 通用保存
  const save = (patch: Partial<typeof worldview>) =>
    saveWorldview({ projectId: project.id!, ...patch })

  return (
    <div className="flex h-full w-full flex-col space-y-4">
      {/* 顶部 */}
      <div className="shrink-0 border-b border-border/40 px-6 pb-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
            🌌 世界起源与核心设定
          </h2>
          {project.enableMultiWorld && <WorldGroupSwitcher />}
        </div>
        <p className="text-xs text-text-muted mt-0.5">
          定义世界的起源、力量体系与信仰体系。如需声明真实与幻想的规则，请前往「⚖️ 真实与幻想」面板。
        </p>
        <div className="mt-3 max-w-xl">
          <CodexSearchBar
            categoryKeys={['originSource', 'originPower', 'originDeity']}
            onJump={(catKey) => setActive(catKey === 'originSource' ? 'origin' : catKey === 'originDeity' ? 'divine' : 'power')}
          />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── 左侧边栏 ── */}
        <nav className="w-max min-w-32 max-w-44 flex-shrink-0 overflow-y-auto border-r border-border py-4 pr-1">
          {FIELDS.map(f => {
            const isActive = active === f.key
            return (
              <button
                key={f.key}
                onClick={() => setActive(f.key)}
                className={`flex w-full items-center gap-1 border-l-2 px-4 py-2.5 text-left text-sm transition-colors ${
                  isActive
                    ? 'border-accent bg-accent/8 font-medium text-accent'
                    : 'border-transparent text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
                }`}
              >
                <span className="flex-1">{f.icon} {f.label}</span>
              </button>
            )
          })}
        </nav>

        {/* ── 右侧：所有字段同时渲染，hidden 控制显示 ── */}
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-6">
          {/* 世界来源 */}
          <div className={active === 'origin' ? 'h-full' : 'hidden'}>
            <TextFieldEditor
              field={FIELDS[0]}
              value={worldOrigin}
              onChange={v => { setWorldOrigin(v); save({ worldOrigin: v }) }}
              project={project}
              codexContent={(
                <WorldviewCodexSection
                  title="世界来源 · 具体词条"
                  description="把创世来源、文明起点与关键起源事件逐条登记，并纳入 AI 生成上下文。"
                >
                  <CodexPanel
                    project={project}
                    fixedCategoryKeys={['originSource']}
                    extractionSourceText={worldOrigin}
                    embedded
                  />
                </WorldviewCodexSection>
              )}
            />
          </div>

          {/* 力量体系:全貌(上) + 具体词条(下) */}
          <div className={active === 'power' ? 'h-full' : 'hidden'}>
            <TextFieldEditor
              field={FIELDS[1]}
              value={powerHierarchy}
              onChange={v => { setPowerHierarchy(v); save({ powerHierarchy: v }) }}
              project={project}
              codexContent={(
                <WorldviewCodexSection
                  title="力量层级 · 具体词条"
                  description="把各等级或层级逐条登记，可自定义字段、标记重要度，并进入 AI 生成上下文。"
                >
                  <CodexPanel
                    project={project}
                    fixedCategoryKeys={['originPower']}
                    extractionSourceText={powerHierarchy}
                    embedded
                  />
                </WorldviewCodexSection>
              )}
            />
          </div>

          {/* 神明与信仰:全貌(上) + 具体词条(下) */}
          <div className={active === 'divine' ? 'h-full' : 'hidden'}>
            <DivineFieldEditor
              field={FIELDS[2]}
              divineDesign={divineDesign}
              onDivineChange={async (next) => {
                setDivineDesign(next)
                await save({ divineDesign: next })
              }}
              project={project}
              codexContent={(
                <WorldviewCodexSection
                  title="神明信仰 · 具体词条"
                  description="把神明、教派与信仰规则逐条登记，可自定义字段、标记重要度，并进入 AI 生成上下文。"
                >
                  <CodexPanel
                    project={project}
                    fixedCategoryKeys={['originDeity']}
                    extractionSourceText={[
                      divineDesign.divineNames,
                      divineDesign.divineRank,
                      divineDesign.divineRules,
                    ].filter(Boolean).join('\n\n')}
                    embedded
                  />
                </WorldviewCodexSection>
              )}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 文本字段编辑器（世界来源 / 力量体系） ────────────────────────

function TextFieldEditor({
  field, value, onChange, project, codexContent,
}: {
  field: typeof FIELDS[number]
  value: string
  onChange: (v: string) => void
  project: Project
  codexContent?: ReactNode
}) {
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)

  const body = (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pr-1">
      <WorldviewAgentControls
        project={project}
        module="worldview-origin"
        field={field.key === 'origin' ? 'worldOrigin' : 'powerHierarchy'}
        label={field.label}
        currentValue={value}
        worldGroupId={project.enableMultiWorld ? activeGroupId : null}
      />

      <MarkdownFieldEditor
        value={value}
        onChange={onChange}
        placeholder={field.desc}
        label={`${field.label}正文`}
        fill
      />
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
          <span>{field.icon}</span> {field.label}
        </h2>
        <p className="text-xs text-text-muted mt-0.5">{field.desc}</p>
      </div>
      <WorldviewEditorTabs label={field.label} body={body} codex={codexContent} />
    </div>
  )
}

// ── 神明与信仰编辑器（独立 AI 流） ─────────────────────────────────

function DivineFieldEditor({
  field, divineDesign, onDivineChange, project, codexContent,
}: {
  field: typeof FIELDS[number]
  divineDesign: DivineDesign
  onDivineChange: (next: DivineDesign) => Promise<void>
  project: Project
  codexContent?: ReactNode
}) {
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
          <span>{field.icon}</span> {field.label}
        </h2>
        <p className="text-xs text-text-muted mt-0.5">{field.desc}</p>
      </div>

      <WorldviewEditorTabs
        label={field.label}
        codex={codexContent}
        body={(
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain pr-1">

      <WorldviewAgentControls
        project={project}
        module="worldview-origin"
        field="divineDesign"
        label="神明与信仰"
        currentValue={divineDesign}
        worldGroupId={project.enableMultiWorld ? activeGroupId : null}
      />

      {/* 存在神明/信仰 checkbox */}
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={divineDesign.hasDivinity}
          onChange={e => {
            onDivineChange({ ...divineDesign, hasDivinity: e.target.checked })
          }}
          className="accent-accent"
        />
        <span className="text-text-secondary">存在神明或宗教信仰</span>
      </label>

      {divineDesign.hasDivinity && (
        <div className="grid gap-3">
              <MarkdownFieldEditor
                value={divineDesign.divineRank}
                onChange={v => onDivineChange({ ...divineDesign, divineRank: v })}
                placeholder="例：主神 / 次神 / 半神 / 国教 / 民间信仰 ..."
                label="信仰层级"
                compact
              />
              <MarkdownFieldEditor
                value={divineDesign.divineNames}
                onChange={v => onDivineChange({ ...divineDesign, divineNames: v })}
                placeholder="例：天帝 · 创世神；关帝信仰；妈祖信仰 ..."
                label="名号与职司"
                compact
              />
              <MarkdownFieldEditor
                value={divineDesign.divineRules}
                onChange={v => onDivineChange({ ...divineDesign, divineRules: v })}
                placeholder="例：不可直接干涉凡间 / 避讳字 / 祭祀风俗 ..."
                label="规则与禁忌"
                compact
              />
        </div>
      )}
          </div>
        )}
      />
    </div>
  )
}
