/**
 * 章节摘要适配器 — Phase A3
 * 输入：章节正文 → 输出：100-200 字精炼摘要
 * 用于三层记忆系统的 Working Memory 层
 */
import type { ChatMessage } from '../../types'

/**
 * 构建章节摘要生成 prompt
 * @param chapterTitle 章节标题
 * @param chapterText 章节正文（纯文本）
 * @param maxChars 正文最大截取长度
 */
export function buildSummaryPrompt(
  chapterTitle: string,
  chapterText: string,
  maxChars = 6000,
): ChatMessage[] {
  const trimmedText = chapterText.length > maxChars
    ? chapterText.slice(0, maxChars) + '\n…（后文省略）'
    : chapterText

  const systemPrompt = `你是一个小说章节摘要生成器。你的任务是为章节内容生成一段精炼的摘要。

要求：
1. 摘要长度 100-200 字
2. 包含本章的**关键情节推进**（发生了什么事、角色做了什么决定）
3. 包含**人物关系变化**（如果有）
4. 包含**重要线索/伏笔**的推进（如果有）
5. 使用第三人称客观叙述，不要有个人评价
6. 不要用"本章讲述了"等元叙述开头，直接概括事件
7. 按时间顺序组织，突出因果关系

直接输出摘要文本，不要加任何标题、标记或解释。`

  const userPrompt = `【章节标题】${chapterTitle}\n\n【章节内容】\n${trimmedText}\n\n请生成摘要：`

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]
}
