/**
 * WorldMapPanel — 世界地图主面板
 * 顶层容器：世界树导航 + AI 生成按钮 + Voronoi/2D/3D 切换 + Canvas + 属性编辑器
 */

import { useState, useEffect, lazy, Suspense } from 'react'
import { Sparkles, Loader2, RefreshCw, Map, Box, Globe } from 'lucide-react'
import { useWorldNodeStore } from '../../stores/world-node'
import { useWorldGroupStore } from '../../stores/world-group'
import WorldGroupSwitcher from '../world-group/WorldGroupSwitcher'
import { dispatchAgentIntent } from '../../lib/agent/intents'
import type { Project } from '../../lib/types'
import type { MapGenConfig } from '../../lib/world-map/engine'
import WorldTreeSidebar from './WorldTreeSidebar'

// Voronoi 地图引擎组件懒加载
const WorldMapVoronoi = lazy(() => import('./WorldMapVoronoi'))

interface Props {
  project: Project
}

type ViewMode = '3d' | 'voronoi'

export default function WorldMapPanel({ project }: Props) {
  const { nodes, activeWorldId, loadNodes, ensureRootWorld } = useWorldNodeStore()
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)

  const [viewMode, setViewMode] = useState<ViewMode>('voronoi')

  // 当前活跃世界的 Voronoi 配置
  const [voronoiConfig, setVoronoiConfig] = useState<Partial<MapGenConfig> | undefined>(undefined)

  // 多世界模式下世界树按世界组隔离；单世界传 null 走原逻辑
  const scopedGroupId = project.enableMultiWorld ? activeGroupId : null

  // ── 初始化世界树（按世界组作用域） ──
  useEffect(() => {
    if (!project.id) return
    ensureRootWorld(project.id, scopedGroupId).then(() => loadNodes(project.id!, scopedGroupId))
  }, [project.id, scopedGroupId, ensureRootWorld, loadNodes])

  // ── 切换世界时加载该世界的地图配置 ──
  const activeNode = nodes.find(n => n.id === activeWorldId)

  useEffect(() => {
    if (!activeNode) {
      setVoronoiConfig(undefined)
      return
    }
    // 从世界节点加载地图配置
    if (activeNode.mapConfigJSON) {
      try {
        setVoronoiConfig(JSON.parse(activeNode.mapConfigJSON))
      } catch {
        setVoronoiConfig(undefined)
      }
    } else {
      setVoronoiConfig(undefined)
    }
  }, [activeNode])

  // ── AI 生成地图 ─────────────────────────────────────────
  const handleGenerate = () => {
    if (!activeNode || !activeWorldId) return
    dispatchAgentIntent({
      type: 'geography.world-map',
      title: `Agent 生成地图 · ${activeNode.name}`,
      promptModuleKey: 'geography.world-map',
      source: {
        project: { backend: 'dexie', projectId: project.id! },
        module: 'world-map',
        field: 'mapConfigJSON',
        worldGroupId: scopedGroupId,
        entityId: activeWorldId,
      },
      instruction: [
        `为世界节点“${activeNode.name}”生成 Voronoi 地图引擎配置。`,
        '先读取 worldview、codex、worldRules、historical 和 locations，必须保留已登记的国家、势力、城池、山川和河流名称。',
        `最终调用 storyforge.change.propose，使用 target=worldNodes、mode=replace、recordId=${activeWorldId}，data 只能包含 mapConfigJSON。`,
        'mapConfigJSON 必须是可被 JSON.parse 解析的对象或 JSON 字符串，包含 seed、mapName、pointCount、landRatio、continentCount、stateCount、burgDensity、temperatureShift、precipitationFactor、heightmapTemplate、namingStyle、stateNames、burgNames、riverNames。',
        'heightmapTemplate 只能取 continents、pangea、archipelago、volcano、isthmus、peninsula、mediterranean、atoll、shattered、highland；namingStyle 只能取 chinese、japanese、european、arabic、highFantasy、darkFantasy。',
        '不要只展示 JSON 后停止，必须生成可审批方案。',
      ].join('\n'),
      completionRequirement: {
        kind: 'change-proposal',
        target: 'worldNodes',
        mode: 'replace',
        recordId: activeWorldId,
        requiredFields: ['mapConfigJSON'],
        requiredDataPaths: [['mapConfigJSON']],
        requiredContextSources: ['worldview', 'codex', 'worldRules', 'historical', 'locations'],
        deliverableKind: 'structured-record',
      },
      payload: {
        worldName: activeNode.name,
        worldNode: activeNode,
        currentMapConfig: voronoiConfig ?? null,
      },
    })
  }

  // ── 渲染 ─────────────────────────────────────────────────
  const generateButtonLabel = voronoiConfig ? 'Agent 重新生成' : 'Agent 生成地图'

  return (
    <div className="h-full flex flex-col">
      {/* 工具栏 */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
          <Map className="w-5 h-5" />
          世界地图
          {activeNode && (
            <span className="text-sm font-normal text-text-muted ml-1">
              — {activeNode.icon} {activeNode.name}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {/* 多世界：世界组切换（切换后整套世界树+地图跟随） */}
          {project.enableMultiWorld && <WorldGroupSwitcher />}
          {/* 视图切换 */}
          <div className="flex bg-bg-elevated rounded-lg p-0.5 border border-border">
            <button
              onClick={() => setViewMode('voronoi')}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors ${
                viewMode === 'voronoi'
                  ? 'bg-accent text-white'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <Globe className="w-3 h-3" /> 奇幻
            </button>
            <button
              type="button"
              disabled
              title="3D 地图仍处于 Labs 阶段，当前不可用"
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors text-text-muted/50 cursor-not-allowed"
            >
              <Box className="w-3 h-3" /> 3D Labs
            </button>
          </div>

          <button
            onClick={handleGenerate}
            disabled={!activeWorldId}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {voronoiConfig ? (
              <>
                <RefreshCw className="w-4 h-4" />
                {generateButtonLabel}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Agent 生成地图
              </>
            )}
          </button>
        </div>
      </div>


      {/* 主内容区域：世界树 + 地图 */}
      <div className="flex-1 flex min-h-0 rounded-lg overflow-hidden border border-border">
        {/* 世界树侧边栏 */}
        <WorldTreeSidebar projectId={project.id!} />

        {/* 地图区域 — 奇幻 Voronoi 地图 */}
        <div className="flex-1 min-w-0">
          <Suspense fallback={
            <div className="w-full h-full flex items-center justify-center bg-[#1a1f2e]">
              <div className="text-center text-text-muted">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-accent" />
                <p className="text-sm">加载地图引擎...</p>
              </div>
            </div>
          }>
            <WorldMapVoronoi
              key={activeWorldId ?? 'default'}
              config={voronoiConfig}
            />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
