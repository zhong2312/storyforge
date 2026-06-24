/**
 * NS-4 · 事实账本 store（事实库 UI 的数据层）。
 * 所有事实变更走 lib/fact-ledger 单一入口（adopt/confirm/reject），store 不裸散写业务逻辑。
 */
import { create } from 'zustand'
import type { TemporalFact } from '../lib/types/temporal-fact'
import type { ExtractedFactCandidate } from '../lib/ai/adapters/fact-extract-adapter'
import {
  adoptFactCandidates,
  confirmFactCandidate,
  rejectFactCandidate,
  listFacts,
} from '../lib/fact-ledger/fact-ledger'

interface FactLedgerStore {
  facts: TemporalFact[]
  loading: boolean
  load: (projectId: number) => Promise<void>
  adopt: (args: { projectId: number; sourceChapterId: number; worldGroupId?: number | null; candidates: ExtractedFactCandidate[] }) => Promise<number>
  confirm: (projectId: number, factId: number) => Promise<void>
  reject: (projectId: number, factId: number) => Promise<void>
}

export const useFactLedgerStore = create<FactLedgerStore>((set, get) => ({
  facts: [],
  loading: false,

  load: async (projectId) => {
    set({ loading: true })
    try {
      set({ facts: await listFacts(projectId) })
    } finally {
      set({ loading: false })
    }
  },

  adopt: async ({ projectId, sourceChapterId, worldGroupId, candidates }) => {
    const result = await adoptFactCandidates({ projectId, sourceChapterId, worldGroupId, candidates })
    await get().load(projectId)
    return result.written
  },

  confirm: async (projectId, factId) => {
    await confirmFactCandidate(factId)
    await get().load(projectId)
  },

  reject: async (projectId, factId) => {
    await rejectFactCandidate(factId)
    await get().load(projectId)
  },
}))
