import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { Foreshadow, ForeshadowStatus, ForeshadowUrgency } from '../lib/types'

const FORESHADOW_TYPE_LABELS: Record<string, string> = {
  chekhov: '契诃夫之枪', prophecy: '预言暗示', symbol: '象征伏笔',
  character: '角色伏笔', dialogue: '对话伏笔', environment: '环境伏笔',
  timeline: '时间线伏笔', 'red-herring': '红鲱鱼', parallel: '平行伏笔', callback: '回调伏笔',
}

interface ForeshadowStore {
  foreshadows: Foreshadow[]
  loading: boolean

  loadAll: (projectId: number) => Promise<void>
  addForeshadow: (f: Omit<Foreshadow, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  updateForeshadow: (id: number, data: Partial<Foreshadow>) => Promise<void>
  deleteForeshadow: (id: number) => Promise<void>
  updateStatus: (id: number, status: ForeshadowStatus) => Promise<void>

  // ── Phase C1: 逾期检测 ──
  /** 获取已逾期（超过预期回收章节但仍未回收）的伏笔 */
  getOverdue: (currentChapterId: number) => Foreshadow[]
  /** 获取即将需要回收的伏笔（在未来 range 章内） */
  getUpcoming: (currentChapterId: number, range?: number) => Foreshadow[]
  /** 计算单条伏笔的紧急度 */
  computeUrgency: (f: Foreshadow, currentChapterId: number) => ForeshadowUrgency

  // ── Phase C2: 伏笔上下文构建（注入 AI prompt） ──
  buildForeshadowContext: (currentChapterId: number) => string
}

const now = () => Date.now()

export const useForeshadowStore = create<ForeshadowStore>((set, get) => ({
  foreshadows: [],
  loading: false,

  loadAll: async (projectId: number) => {
    set({ loading: true })
    const foreshadows = await db.foreshadows
      .where('projectId').equals(projectId)
      .toArray()
    set({ foreshadows, loading: false })
  },

  addForeshadow: async (f) => {
    const newF: Foreshadow = { ...f, createdAt: now(), updatedAt: now() }
    const id = await db.foreshadows.add(newF) as number
    set({ foreshadows: [...get().foreshadows, { ...newF, id }] })
    return id
  },

  updateForeshadow: async (id, data) => {
    await db.foreshadows.update(id, { ...data, updatedAt: now() })
    set({
      foreshadows: get().foreshadows.map(f =>
        f.id === id ? { ...f, ...data, updatedAt: now() } : f
      ),
    })
  },

  deleteForeshadow: async (id) => {
    await db.foreshadows.delete(id)
    set({ foreshadows: get().foreshadows.filter(f => f.id !== id) })
  },

  updateStatus: async (id, status) => {
    await db.foreshadows.update(id, { status, updatedAt: now() })
    set({
      foreshadows: get().foreshadows.map(f =>
        f.id === id ? { ...f, status, updatedAt: now() } : f
      ),
    })
  },

  // ── Phase C1 ──

  getOverdue: (currentChapterId) => {
    return get().foreshadows.filter(f => {
      if (f.status === 'resolved') return false
      if (!f.expectedResolveChapterId) return false
      return f.expectedResolveChapterId < currentChapterId && !f.resolveChapterId
    })
  },

  getUpcoming: (currentChapterId, range = 5) => {
    return get().foreshadows.filter(f => {
      if (f.status === 'resolved') return false
      if (!f.expectedResolveChapterId) return false
      const diff = f.expectedResolveChapterId - currentChapterId
      return diff > 0 && diff <= range
    })
  },

  computeUrgency: (f, currentChapterId) => {
    if (f.status === 'resolved') return 'low'
    if (!f.expectedResolveChapterId) {
      // 没有预期回收，按重要度粗略判定
      return (f.importance || 5) >= 8 ? 'medium' : 'low'
    }
    const diff = f.expectedResolveChapterId - currentChapterId
    if (diff < 0) return 'critical'  // 已逾期
    if (diff <= 2) return 'high'     // 即将到期
    if (diff <= 5) return 'medium'   // 临近
    return 'low'
  },

  // ── Phase C2 ──

  buildForeshadowContext: (currentChapterId) => {
    const { foreshadows, computeUrgency } = get()
    const open = foreshadows.filter(f => f.status !== 'resolved')
    if (!open.length) return ''

    const parts: string[] = ['【当前章节伏笔任务】']

    // 1. 当前章节需要埋设的伏笔
    const toPlant = open.filter(f => f.plantChapterId === currentChapterId && f.status === 'planned')
    for (const f of toPlant) {
      parts.push(`- [埋设] "${f.name}"（${FORESHADOW_TYPE_LABELS[f.type] || f.type}）：${f.description}`)
    }

    // 2. 当前章节需要回收的伏笔
    const toResolve = open.filter(f => f.expectedResolveChapterId === currentChapterId)
    for (const f of toResolve) {
      parts.push(`- [回收] "${f.name}"（${FORESHADOW_TYPE_LABELS[f.type] || f.type}）：应在本章揭示/回收 — ${f.description}`)
    }

    // 3. 当前章节需要呼应的伏笔
    const toEcho = open.filter(f => {
      try {
        const echoIds: number[] = JSON.parse(f.echoChapterIds || '[]')
        return echoIds.includes(currentChapterId)
      } catch { return false }
    })
    for (const f of toEcho) {
      parts.push(`- [呼应] "${f.name}"（${FORESHADOW_TYPE_LABELS[f.type] || f.type}）：侧面提及相关线索 — ${f.description}`)
    }

    // 4. 逾期伏笔（紧急提醒）
    const overdue = open.filter(f => {
      const u = computeUrgency(f, currentChapterId)
      return u === 'critical' && !toResolve.includes(f)
    })
    for (const f of overdue) {
      parts.push(`- [逾期！] "${f.name}"（${FORESHADOW_TYPE_LABELS[f.type] || f.type}）：已超过预期回收章节，请尽快处理 — ${f.description}`)
    }

    // 5. 即将到期的伏笔（提示）
    const upcoming = open.filter(f => {
      const u = computeUrgency(f, currentChapterId)
      return u === 'high' && !toResolve.includes(f) && !overdue.includes(f)
    })
    if (upcoming.length > 0) {
      parts.push(`\n【即将需要回收的伏笔】`)
      for (const f of upcoming) {
        parts.push(`- "${f.name}"：预计 ${f.expectedResolveChapterId ? `第${f.expectedResolveChapterId}章` : '近期'} 回收`)
      }
    }

    if (parts.length <= 1) return '' // 没有任何伏笔任务
    return parts.join('\n')
  },
}))
