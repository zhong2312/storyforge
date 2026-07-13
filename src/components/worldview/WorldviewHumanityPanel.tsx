import { useState, useEffect, type ReactNode } from 'react'
import { useWorldviewStore } from '../../stores/worldview'
import { useWorldGroupStore } from '../../stores/world-group'
import WorldGroupSwitcher from '../world-group/WorldGroupSwitcher'
import type { Project } from '../../lib/types'
import MarkdownFieldEditor from '../shared/MarkdownFieldEditor'
import WorldviewCodexSection from '../shared/WorldviewCodexSection'
import WorldviewEditorTabs from '../shared/WorldviewEditorTabs'
import WorldviewAgentControls from './WorldviewAgentControls'
import CodexPanel from '../codex/CodexPanel'
import CodexSearchBar from '../codex/CodexSearchBar'

// ── 字段定义（统一标签，兼容幻想与历史） ─────────────────────────

interface FieldMeta {
  key: string       // skipKey for buildCtx
  field: string     // worldview store field name
  emoji: string
  label: string
  description: string
  /** 与独立管理面板重叠时的导航提示 */
  hint?: string
}

const FIELDS: FieldMeta[] = [
  { key: 'history',   field: 'historyLine',            emoji: '📜', label: '世界历史线',     description: '从远古到当下的时间脉络（朝代 / 时代 / 关键节点 / 架空度）', hint: '这里写概述脉络；具体事件、纪年与考证请到「📜 历史年表」逐条管理。' },
  { key: 'events',    field: 'worldEvents',            emoji: '📅', label: '世界大事记',     description: '改变世界格局的重大事件（战争、王朝兴替、灾劫……）', hint: '这里写大事概览；详细时间线事件请到「📜 历史年表」管理。' },
  { key: 'races',     field: 'races',                  emoji: '🧬', label: '种族与民族',     description: '不同种族 / 民族的特征、能力、历史与关系' },
  { key: 'factions',  field: 'factionLayout',          emoji: '⚔',  label: '势力分布',       description: '主要势力（门派 / 朝廷 / 商会 / 党派……）的格局和敌友关系' },
  { key: 'cities',    field: 'regionDimensions',       emoji: '🏰', label: '城池重镇',       description: '核心城市、军事重镇、商业都会的分布与格局' },
  { key: 'pec',       field: 'politicsEconomyCulture', emoji: '🏛', label: '政治/经济/文化', description: '政体 / 货币 / 赋税 / 阶层制度 / 宗教信仰 / 风俗节庆' },
  { key: 'conflicts', field: 'internalConflicts',      emoji: '🔥', label: '矛盾冲突',       description: '社会内在矛盾 / 阶级冲突 / 个体与集体冲突 / 与外部世界的张力' },
  { key: 'items',     field: 'itemDesign',             emoji: '🗡', label: '道具与器物',     description: '武器 / 法器 / 工具 / 科技装备……物品的来源、品级、规则', hint: '这里写物品体系概述；具体道具在下方「📚 道具与器物 · 具体词条」逐条管理，主角实际获得与消耗的物品由创作区「🎒 物品栏」追踪。' },
]

// 每个方面(子页) → 其专属词条分类(builtInKey)。下方只显示该方面对应的词条。
const HUMANITY_CODEX_KEYS: Record<string, string[] | undefined> = {
  history: ['humEra'],
  events: ['humEvent'],
  races: ['race'],
  factions: ['faction'],
  cities: ['city'],
  pec: ['humSociety'],
  conflicts: ['humConflict'],
  items: ['artifact'],
}

// ── 主面板 ─────────────────────────────────────────────────────

interface Props { project: Project }

export default function WorldviewHumanityPanel({ project }: Props) {
  const { worldview, saveWorldview, loadAll } = useWorldviewStore()
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)

  const [values, setValues] = useState<Record<string, string>>({})
  const [activeKey, setActiveKey] = useState(FIELDS[0].key)

  useEffect(() => {
    loadAll(project.id!, project.enableMultiWorld ? activeGroupId : null)
  }, [project.id, project.enableMultiWorld, activeGroupId, loadAll])

  useEffect(() => {
    if (!worldview) return
    setValues({
      history:   worldview.historyLine || '',
      events:    worldview.worldEvents || '',
      races:     worldview.races || '',
      factions:  worldview.factionLayout || '',
      cities:    worldview.regionDimensions || '',
      pec:       worldview.politicsEconomyCulture || '',
      conflicts: worldview.internalConflicts || '',
      items:     worldview.itemDesign || '',
    })
  }, [worldview])

  const save = (fieldName: string, v: string) =>
    saveWorldview({ projectId: project.id!, [fieldName]: v })

  return (
    <div className="flex flex-col w-full h-full space-y-4">
      {/* 顶部 */}
      <div className="pb-4 border-b border-border/40 px-6 pt-4 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
            🏛️ 人文环境与社会
          </h2>
          {project.enableMultiWorld && <WorldGroupSwitcher />}
        </div>
        <p className="text-xs text-text-muted mt-0.5">
          定义世界的历史、势力、政经文化与社会矛盾。如需声明真实与幻想的规则，请前往「⚖️ 真实与幻想」面板。
        </p>
        {/* 词条搜索:跨本面板所有方面,点结果跳到对应子页 */}
        <div className="mt-3 max-w-xl">
          <CodexSearchBar
            categoryKeys={[...new Set(Object.values(HUMANITY_CODEX_KEYS).flat().filter(Boolean) as string[])]}
            onJump={(catKey) => {
              const sub = Object.keys(HUMANITY_CODEX_KEYS).find(k => HUMANITY_CODEX_KEYS[k]?.includes(catKey))
              if (sub) setActiveKey(sub)
            }}
          />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── 左侧导航 ── */}
        <nav className="w-max min-w-32 max-w-44 flex-shrink-0 border-r border-border overflow-y-auto py-4 pr-1">
          {FIELDS.map(f => {
            const isActive = f.key === activeKey
            return (
              <button
                key={f.key}
                onClick={() => setActiveKey(f.key)}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors border-l-2 flex items-center gap-1 ${
                  isActive
                    ? 'border-accent bg-accent/8 text-accent font-medium'
                    : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                }`}
              >
                <span className="flex-1">{f.emoji} {f.label}</span>
              </button>
            )
          })}
        </nav>

        {/* ── 右侧：所有字段同时渲染，hidden 控制显示 ── */}
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-6">
          {FIELDS.map(f => (
            <div key={f.key} className={activeKey === f.key ? 'h-full' : 'hidden'}>
              {/* 全貌（上）：现有字段本身就是这个方面的整体概述，带 AI 生成 */}
              <HumanityFieldEditor
                meta={f}
                value={values[f.key] || ''}
                onChange={v => {
                  setValues(prev => ({ ...prev, [f.key]: v }))
                  save(f.field, v)
                }}
                project={project}
                codexContent={HUMANITY_CODEX_KEYS[f.key] ? (
                  <WorldviewCodexSection
                    title={`${f.label} · 具体词条`}
                    description={`把“${f.label}”逐条细化登记，可自定义字段、标记重要度，并进入 AI 生成上下文。`}
                  >
                    <CodexPanel
                      project={project}
                      fixedCategoryKeys={HUMANITY_CODEX_KEYS[f.key]}
                      extractionSourceText={values[f.key] || ''}
                      embedded
                    />
                  </WorldviewCodexSection>
                ) : undefined}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 单字段编辑器（各自独立的 AI 流） ──────────────────────────

function HumanityFieldEditor({
  meta, value, onChange, project, codexContent,
}: {
  meta: FieldMeta
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
        module="worldview-humanity"
        field={meta.field}
        label={meta.label}
        currentValue={value}
        worldGroupId={project.enableMultiWorld ? activeGroupId : null}
      />

      <MarkdownFieldEditor
        value={value}
        onChange={onChange}
        placeholder={meta.description}
        label={`${meta.label}正文`}
        fill
      />
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <h3 className="text-lg font-semibold text-text-primary">{meta.emoji} {meta.label}</h3>
        <p className="mt-1 text-sm text-text-muted">{meta.description}</p>
        {meta.hint && (
          <p className="mt-1.5 text-xs text-accent/80 bg-accent/5 border border-accent/15 rounded px-2 py-1">
            💡 {meta.hint}
          </p>
        )}
      </div>
      <WorldviewEditorTabs label={meta.label} body={body} codex={codexContent} />
    </div>
  )
}
