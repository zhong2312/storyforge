/**
 * 事件时间线 — Phase A4
 * 按章节顺序展示所有重大事件（从状态卡 category='event' 读取）
 */
import { useMemo } from 'react'
import { Clock, MapPin, Users } from 'lucide-react'
import { useStateCardStore } from '../../stores/state-card'
import { parseFields } from '../../lib/types/state-card'

interface Props {
  projectId: number
}

export default function EventTimeline({ projectId }: Props) {
  const { cards } = useStateCardStore()

  const events = useMemo(() => {
    return cards
      .filter(c => c.category === 'event' && c.projectId === projectId)
      .sort((a, b) => (a.lastChapterId || 0) - (b.lastChapterId || 0))
      .map(card => {
        const fields = parseFields(card.fields)
        const fieldMap = Object.fromEntries(fields.map(f => [f.key, f.value]))
        return {
          id: card.id,
          name: card.entityName,
          chapterId: card.lastChapterId,
          fields: fieldMap,
          updatedAt: card.updatedAt,
        }
      })
  }, [cards, projectId])

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-text-muted text-sm">
        <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p>暂无事件记录</p>
        <p className="text-xs mt-1">AI 写作完成后自动提取的重大事件会显示在这里</p>
      </div>
    )
  }

  return (
    <div className="space-y-0">
      <h3 className="text-sm font-medium text-text-secondary mb-3 flex items-center gap-1.5">
        <Clock className="w-4 h-4" />
        事件时间线（{events.length}）
      </h3>

      <div className="relative pl-6">
        {/* 时间线竖线 */}
        <div className="absolute left-2.5 top-0 bottom-0 w-px bg-border" />

        {events.map((ev) => (
          <div key={ev.id} className="relative mb-4 last:mb-0">
            {/* 时间线节点 */}
            <div className="absolute -left-3.5 top-1.5 w-3 h-3 rounded-full bg-accent border-2 border-bg-surface" />

            <div className="bg-bg-surface border border-border rounded-lg p-3">
              {/* 事件名 + 章节 */}
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-text-primary">{ev.name}</span>
                {ev.chapterId && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-bg-elevated rounded text-text-muted">
                    章节 #{ev.chapterId}
                  </span>
                )}
              </div>

              {/* 事件详情字段 */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
                {Object.entries(ev.fields).map(([key, val]) => (
                  <span key={key} className="flex items-center gap-1">
                    {key.includes('地点') || key.includes('位置') ? <MapPin className="w-3 h-3 text-green-400" /> :
                     key.includes('角色') || key.includes('参与') ? <Users className="w-3 h-3 text-blue-400" /> :
                     null}
                    <span className="text-text-muted">{key}：</span>
                    {val}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
