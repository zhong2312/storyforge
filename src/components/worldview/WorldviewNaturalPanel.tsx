import { useState, useEffect } from 'react'
import { useWorldviewStore } from '../../stores/worldview'
import WorldviewFieldEditor from './WorldviewFieldEditor'
import type { Project, NaturalResources } from '../../lib/types'

interface Props {
  project: Project
}

/** v3 §2.1 — 世界观.自然环境 */
export default function WorldviewNaturalPanel({ project }: Props) {
  const { worldview, saveWorldview, loadAll } = useWorldviewStore()

  const [worldStructure, setWorldStructure] = useState('')
  const [worldDimensions, setWorldDimensions] = useState('')
  const [continentLayout, setContinentLayout] = useState('')
  const [regionDimensions, setRegionDimensions] = useState('')
  const [mountainsRivers, setMountainsRivers] = useState('')
  const [climateByRegion, setClimateByRegion] = useState('')
  const [naturalResources, setNaturalResources] = useState<NaturalResources>({
    rareCreatures: '', herbs: '', minerals: '', others: '',
  })

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  useEffect(() => {
    if (!worldview) return
    setWorldStructure(worldview.worldStructure || '')
    setWorldDimensions(worldview.worldDimensions || '')
    setContinentLayout(worldview.continentLayout || '')
    setRegionDimensions(worldview.regionDimensions || '')
    setMountainsRivers(worldview.mountainsRivers || '')
    setClimateByRegion(worldview.climateByRegion || '')
    setNaturalResources(worldview.naturalResources || {
      rareCreatures: '', herbs: '', minerals: '', others: '',
    })
  }, [worldview])

  const save = (patch: Partial<typeof worldview>) =>
    saveWorldview({ projectId: project.id!, ...patch })

  // 拼接其他字段做 AI 上下文（保持简短）
  const buildCtx = (skipKey: string): string => {
    const parts: string[] = []
    const map: [string, string, string][] = [
      ['structure', '世界结构', worldStructure],
      ['dim',       '世界尺寸', worldDimensions],
      ['continent', '大陆分布', continentLayout],
      ['region',    '区域面积', regionDimensions],
      ['mountains', '山川河流', mountainsRivers],
      ['climate',   '气候',     climateByRegion],
    ]
    for (const [k, label, val] of map) {
      if (k !== skipKey && val) parts.push(`【${label}】${val.slice(0, 150)}`)
    }
    return parts.join('\n')
  }

  return (
    <div className="max-w-4xl p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-text-primary mb-1">🏔 自然环境</h2>
        <p className="text-sm text-text-muted">世界结构 / 大陆分布 / 山川河流 / 气候 / 自然资源 — 七个维度搭建一个完整的物理世界。</p>
      </div>

      <WorldviewFieldEditor
        label="🌐 世界结构"
        description="单星球 / 多星系 / 多重天 / 套娃世界 / 平行宇宙……世界的物理层级是什么？"
        value={worldStructure}
        onChange={setWorldStructure}
        onSave={v => save({ worldStructure: v })}
        project={project}
        contextSummary={buildCtx('structure')}
        rows={4}
      />

      <WorldviewFieldEditor
        label="📐 世界尺寸"
        description="估算世界整体大小，例如：直径 12000 公里、可居住面积 2 亿平方公里 ..."
        value={worldDimensions}
        onChange={setWorldDimensions}
        onSave={v => save({ worldDimensions: v })}
        project={project}
        contextSummary={buildCtx('dim')}
        rows={3}
      />

      <WorldviewFieldEditor
        label="🗺 大陆分布"
        description="主要大陆数量、相对位置、典型地形特征。"
        value={continentLayout}
        onChange={setContinentLayout}
        onSave={v => save({ continentLayout: v })}
        project={project}
        contextSummary={buildCtx('continent')}
        rows={4}
      />

      <WorldviewFieldEditor
        label="📏 区域面积"
        description="主要文明区域的尺度（国家面积、宗门辖区、自然秘境等）。"
        value={regionDimensions}
        onChange={setRegionDimensions}
        onSave={v => save({ regionDimensions: v })}
        project={project}
        contextSummary={buildCtx('region')}
        rows={3}
      />

      <WorldviewFieldEditor
        label="⛰ 山川河流"
        description="重要山脉、河流、湖泊、海洋的命名与定位。"
        value={mountainsRivers}
        onChange={setMountainsRivers}
        onSave={v => save({ mountainsRivers: v })}
        project={project}
        contextSummary={buildCtx('mountains')}
        rows={4}
      />

      <WorldviewFieldEditor
        label="🌦 分区域气候"
        description="不同地理区域的气候类型与季节特征。"
        value={climateByRegion}
        onChange={setClimateByRegion}
        onSave={v => save({ climateByRegion: v })}
        project={project}
        contextSummary={buildCtx('climate')}
        rows={4}
      />

      {/* 自然资源（嵌套） */}
      <div className="bg-bg-surface border border-border rounded-xl p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">🌿 自然资源</h3>
          <p className="mt-0.5 text-xs text-text-muted">珍禽异兽 / 灵药草药 / 矿石宝石 / 其他特产。</p>
        </div>

        <ResourceSubField
          label="🦅 珍禽异兽"
          placeholder="例：玄龟 / 火凤 / 噬魂蜘蛛 ..."
          value={naturalResources.rareCreatures}
          onChange={v => setNaturalResources(r => ({ ...r, rareCreatures: v }))}
          onSave={v => save({ naturalResources: { ...naturalResources, rareCreatures: v } })}
        />
        <ResourceSubField
          label="🌿 灵药 / 草药"
          placeholder="例：千年雪莲 / 还魂草 / 灵参 ..."
          value={naturalResources.herbs}
          onChange={v => setNaturalResources(r => ({ ...r, herbs: v }))}
          onSave={v => save({ naturalResources: { ...naturalResources, herbs: v } })}
        />
        <ResourceSubField
          label="💎 矿石 / 宝石"
          placeholder="例：玄铁 / 灵石 / 龙血石 ..."
          value={naturalResources.minerals}
          onChange={v => setNaturalResources(r => ({ ...r, minerals: v }))}
          onSave={v => save({ naturalResources: { ...naturalResources, minerals: v } })}
        />
        <ResourceSubField
          label="✨ 其他特产"
          placeholder="例：神木、奇石、稀有元素 ..."
          value={naturalResources.others}
          onChange={v => setNaturalResources(r => ({ ...r, others: v }))}
          onSave={v => save({ naturalResources: { ...naturalResources, others: v } })}
        />
      </div>
    </div>
  )
}

function ResourceSubField({
  label, placeholder, value, onChange, onSave,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  onSave: (v: string) => void
}) {
  return (
    <div>
      <label className="block text-xs text-text-secondary mb-1">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={() => onSave(value)}
        rows={2}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent"
      />
    </div>
  )
}
