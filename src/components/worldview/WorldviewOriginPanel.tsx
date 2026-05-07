import { useState, useEffect } from 'react'
import { useWorldviewStore } from '../../stores/worldview'
import WorldviewFieldEditor from './WorldviewFieldEditor'
import type { Project, DivineDesign } from '../../lib/types'

interface Props {
  project: Project
}

/** v3 §2.1 — 世界观.世界起源（三个子模块） */
export default function WorldviewOriginPanel({ project }: Props) {
  const { worldview, saveWorldview, loadAll } = useWorldviewStore()

  const [worldOrigin, setWorldOrigin] = useState('')
  const [powerHierarchy, setPowerHierarchy] = useState('')
  const [divineDesign, setDivineDesign] = useState<DivineDesign>({
    hasDivinity: false,
    divineRank: '',
    divineNames: '',
    divineRules: '',
  })

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  // 同步 store → 本地 state
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

  // AI 上下文（其他字段的摘要）
  const buildCtx = (excludeKey: string): string => {
    const parts: string[] = []
    if (excludeKey !== 'origin' && worldOrigin) parts.push(`【世界来源】${worldOrigin.slice(0, 200)}`)
    if (excludeKey !== 'power'  && powerHierarchy) parts.push(`【力量层次】${powerHierarchy.slice(0, 200)}`)
    if (excludeKey !== 'divine' && divineDesign.hasDivinity) {
      parts.push(`【神明】${divineDesign.divineNames || ''}：${divineDesign.divineRules?.slice(0, 100) || ''}`)
    }
    return parts.join('\n')
  }

  return (
    <div className="max-w-4xl p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-text-primary mb-1">✨ 世界起源</h2>
        <p className="text-sm text-text-muted">设定世界来源、力量层次、神明体系等创世纪信息。每个字段都可以一键 AI 生成。</p>
      </div>

      {/* 1. 世界来源 */}
      <WorldviewFieldEditor
        label="🌌 世界来源"
        description="创世神话 / 科技起源 / 文明诞生……世界从何而来？"
        value={worldOrigin}
        onChange={setWorldOrigin}
        onSave={v => save({ worldOrigin: v })}
        project={project}
        contextSummary={buildCtx('origin')}
        rows={5}
      />

      {/* 2. 力量层次 */}
      <WorldviewFieldEditor
        label="⚡ 力量层次"
        description="修真等级 / 魔法体系 / 科技层级……力量如何分层、怎么晋升？"
        value={powerHierarchy}
        onChange={setPowerHierarchy}
        onSave={v => save({ powerHierarchy: v })}
        project={project}
        contextSummary={buildCtx('power')}
        rows={5}
      />

      {/* 3. 神明设定 */}
      <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">🌟 神明设定</h3>
            <p className="mt-0.5 text-xs text-text-muted">是否存在神明？神明的层级、名号、规则与限制是什么？</p>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={divineDesign.hasDivinity}
              onChange={e => {
                const next = { ...divineDesign, hasDivinity: e.target.checked }
                setDivineDesign(next)
                save({ divineDesign: next })
              }}
              className="accent-accent"
            />
            <span className="text-text-secondary">存在神明</span>
          </label>
        </div>

        {divineDesign.hasDivinity && (
          <div className="space-y-3 pl-3 border-l-2 border-accent/30">
            <DivineSubField
              label="🏛 神明层级"
              placeholder="例：主神 / 次神 / 半神 / 古神 / 邪神 ..."
              value={divineDesign.divineRank}
              onChange={v => setDivineDesign(d => ({ ...d, divineRank: v }))}
              onSave={v => save({ divineDesign: { ...divineDesign, divineRank: v } })}
            />
            <DivineSubField
              label="📜 主要神明名号"
              placeholder="例：天帝 · 创世神；幽冥之主 ..."
              value={divineDesign.divineNames}
              onChange={v => setDivineDesign(d => ({ ...d, divineNames: v }))}
              onSave={v => save({ divineDesign: { ...divineDesign, divineNames: v } })}
            />
            <DivineSubField
              label="⚖ 神明的规则与限制"
              placeholder="例：不可直接干涉凡间 / 神战禁忌 / 信仰枯竭后陨落 ..."
              value={divineDesign.divineRules}
              onChange={v => setDivineDesign(d => ({ ...d, divineRules: v }))}
              onSave={v => save({ divineDesign: { ...divineDesign, divineRules: v } })}
              rows={3}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function DivineSubField({
  label, placeholder, value, onChange, onSave, rows = 2,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  onSave: (v: string) => void
  rows?: number
}) {
  return (
    <div>
      <label className="block text-xs text-text-secondary mb-1">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={() => onSave(value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
      />
    </div>
  )
}
