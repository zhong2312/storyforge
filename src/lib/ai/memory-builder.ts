/**
 * 三层记忆构建器 — Phase A2
 *
 * Working Memory（工作记忆）：当前章节大纲 + 最近N章摘要 + 情感节拍
 * Episodic Memory（情景记忆）：最近状态变更 + 关键事件 + 人物关系变动
 * Semantic Memory（语义记忆）：世界观 + 力量体系 + 角色档案 + 开放伏笔
 *
 * 按任务类型分配 token 预算：
 *  - write：Working 权重高（紧贴当前剧情）
 *  - plan：Semantic 权重高（把握全局）
 *  - review：Episodic 权重高（关注一致性）
 */

import { db } from '../db/schema'
import type { StateCard } from '../types/state-card'
import { parseFields } from '../types/state-card'

// ── 配置 ──────────────────────────────────────────────

export type MemoryTaskType = 'write' | 'plan' | 'review'

/** 每层的字符上限预算 */
interface MemoryBudget {
  working: number
  episodic: number
  semantic: number
}

const BUDGETS: Record<MemoryTaskType, MemoryBudget> = {
  write:  { working: 3000, episodic: 1500, semantic: 2000 },
  plan:   { working: 1000, episodic: 1500, semantic: 3500 },
  review: { working: 1500, episodic: 3000, semantic: 2000 },
}

// ── 工作记忆（Working Memory）────────────────────────

export interface WorkingMemoryInput {
  /** 当前章节大纲 */
  currentOutline?: { title: string; summary: string } | null
  /** 当前章节的情感节拍上下文 */
  emotionBeatContext?: string
  /** 项目ID，用于查询最近章节摘要 */
  projectId: number
  /** 当前章节序号，用于获取"前N章" */
  currentChapterOrder: number
}

async function buildWorkingMemory(input: WorkingMemoryInput, budget: number): Promise<string> {
  const parts: string[] = []

  // 1. 当前章节大纲
  if (input.currentOutline) {
    parts.push(`【当前章节大纲】\n标题：${input.currentOutline.title}\n摘要：${input.currentOutline.summary}`)
  }

  // 2. 最近 3 章的摘要
  const recentChapters = await db.chapters
    .where('projectId').equals(input.projectId)
    .filter(c => c.order < input.currentChapterOrder)
    .sortBy('order')

  const last3 = recentChapters.slice(-3)
  if (last3.length > 0) {
    const summaryParts: string[] = ['【最近章节回顾】']
    for (const ch of last3) {
      if (ch.summary) {
        summaryParts.push(`第${ch.order + 1}章「${ch.title}」：${ch.summary}`)
      } else if (ch.content) {
        // 没有摘要时取正文末尾作为简要回顾
        const plain = ch.content.replace(/<[^>]+>/g, '').trim()
        const tail = plain.slice(-300)
        summaryParts.push(`第${ch.order + 1}章「${ch.title}」：…${tail}`)
      }
    }
    if (summaryParts.length > 1) {
      parts.push(summaryParts.join('\n'))
    }
  }

  // 3. 情感节拍
  if (input.emotionBeatContext) {
    parts.push(input.emotionBeatContext)
  }

  return truncate(parts.join('\n\n'), budget)
}

// ── 情景记忆（Episodic Memory）────────────────────────

export interface EpisodicMemoryInput {
  /** 项目的全部状态卡 */
  stateCards: StateCard[]
  /** 当前章节ID，用于排序"最近变更" */
  currentChapterId?: number
}

function buildEpisodicMemory(input: EpisodicMemoryInput, budget: number): string {
  const parts: string[] = []

  // 1. 最近的状态变更（按 updatedAt 降序取最近 15 条）
  const recentCards = [...input.stateCards]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 15)

  if (recentCards.length > 0) {
    const changeParts: string[] = ['【近期状态变更】']
    for (const card of recentCards) {
      const fields = parseFields(card.fields)
      const fieldStr = fields.map(f => `${f.key}=${f.value}`).join(', ')
      const chapterNote = card.lastChapterId ? `(章节#${card.lastChapterId})` : ''
      changeParts.push(`- [${card.category}] ${card.entityName}${chapterNote}: ${fieldStr}`)
    }
    parts.push(changeParts.join('\n'))
  }

  // 2. 关键事件（category='event' 的状态卡）
  const events = input.stateCards
    .filter(c => c.category === 'event')
    .sort((a, b) => (a.lastChapterId || 0) - (b.lastChapterId || 0))

  if (events.length > 0) {
    const eventParts: string[] = ['【已发生的关键事件】']
    for (const ev of events) {
      const fields = parseFields(ev.fields)
      const fieldStr = fields.map(f => `${f.key}：${f.value}`).join(' | ')
      eventParts.push(`- ${ev.entityName}：${fieldStr}`)
    }
    parts.push(eventParts.join('\n'))
  }

  // 3. 人物关系变动（character 类卡中 field 含"关系"的）
  const relChanges = input.stateCards
    .filter(c => c.category === 'character')
    .flatMap(c => {
      const fields = parseFields(c.fields)
      return fields
        .filter(f => f.key.includes('关系') || f.key.includes('关联') || f.key.includes('态度'))
        .map(f => `${c.entityName} — ${f.key}：${f.value}`)
    })

  if (relChanges.length > 0) {
    parts.push(`【人物关系动态】\n${relChanges.join('\n')}`)
  }

  return truncate(parts.join('\n\n'), budget)
}

// ── 语义记忆（Semantic Memory）────────────────────────

export interface SemanticMemoryInput {
  /** 世界观上下文（已由 context-builder 生成） */
  worldContext: string
  /** 角色上下文（已由 context-builder 生成） */
  characterContext: string
  /** 开放伏笔列表文本 */
  openForeshadows?: string
  /** 全局故事线（Phase B 之后加入） */
  storyArcContext?: string
}

function buildSemanticMemory(input: SemanticMemoryInput, budget: number): string {
  const parts: string[] = []

  if (input.worldContext) {
    parts.push(input.worldContext)
  }

  if (input.characterContext) {
    parts.push(`【角色档案】\n${input.characterContext}`)
  }

  if (input.storyArcContext) {
    parts.push(input.storyArcContext)
  }

  if (input.openForeshadows) {
    parts.push(input.openForeshadows)
  }

  return truncate(parts.join('\n\n'), budget)
}

// ── 主入口 ────────────────────────────────────────────

export interface MemoryBuilderInput {
  taskType: MemoryTaskType
  working: WorkingMemoryInput
  episodic: EpisodicMemoryInput
  semantic: SemanticMemoryInput
}

export interface BuiltMemory {
  /** 拼装好的完整上下文，可直接注入 system prompt */
  fullContext: string
  /** 各层的独立文本（调试用） */
  layers: {
    working: string
    episodic: string
    semantic: string
  }
  /** 实际字符数统计 */
  stats: {
    working: number
    episodic: number
    semantic: number
    total: number
  }
}

/**
 * 构建三层记忆上下文
 */
export async function buildMemory(input: MemoryBuilderInput): Promise<BuiltMemory> {
  const budget = BUDGETS[input.taskType]

  const [working, episodic, semantic] = await Promise.all([
    buildWorkingMemory(input.working, budget.working),
    Promise.resolve(buildEpisodicMemory(input.episodic, budget.episodic)),
    Promise.resolve(buildSemanticMemory(input.semantic, budget.semantic)),
  ])

  const sections: string[] = []
  if (semantic) sections.push(semantic)
  if (episodic) sections.push(episodic)
  if (working) sections.push(working)

  const fullContext = sections.join('\n\n')

  return {
    fullContext,
    layers: { working, episodic, semantic },
    stats: {
      working: working.length,
      episodic: episodic.length,
      semantic: semantic.length,
      total: fullContext.length,
    },
  }
}

// ── 工具函数 ──────────────────────────────────────────

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  // 在最后一个完整行处截断
  const cut = text.slice(0, maxChars)
  const lastNewline = cut.lastIndexOf('\n')
  if (lastNewline > maxChars * 0.8) {
    return cut.slice(0, lastNewline) + '\n…（记忆截断）'
  }
  return cut + '\n…（记忆截断）'
}
