/**
 * 伏笔建议适配器 — Phase C3
 * 根据故事线 + 已有伏笔 + 大纲 → AI 建议新的伏笔点
 */
import type { ChatMessage } from '../../types'

export function buildForeshadowSuggestPrompt(
  projectName: string,
  genre: string,
  storyArcContext: string,
  existingForeshadows: string,
  outlineSummary: string,
  worldContext: string,
): ChatMessage[] {
  const systemPrompt = `你是一个小说伏笔策划专家。根据提供的故事线、已有伏笔和大纲，建议新的伏笔点。

伏笔类型说明：
- chekhov（契诃夫之枪）：早期展示的道具/细节，后期发挥关键作用
- prophecy（预言暗示）：预示未来事件的暗示
- symbol（象征伏笔）：通过象征物暗示主题或命运
- character（角色伏笔）：角色行为/对话中暗藏的线索
- dialogue（对话伏笔）：对话中不经意透露的关键信息
- environment（环境伏笔）：环境描写中隐藏的线索
- parallel（平行伏笔）：与主线平行发展的暗线

要求：
1. 建议 3-5 个伏笔
2. 每个伏笔不要与已有伏笔重复
3. 伏笔应服务于故事主线或重要支线
4. 标注推荐的埋设章节位置和预期回收位置
5. 给出重要度评分（1-10）

输出严格 JSON 数组，不要加 markdown 代码块：
[
  {
    "name": "伏笔名称",
    "type": "chekhov|prophecy|symbol|character|dialogue|environment|parallel",
    "description": "伏笔描述（如何埋设、如何回收）",
    "importance": 8,
    "suggestedPlantChapter": "第X章/第X卷开头",
    "suggestedResolveChapter": "第X章/第X卷结尾"
  }
]`

  const parts = [`【项目】${projectName}（${genre || '未知题材'}）`]
  if (storyArcContext) parts.push(`【故事线】\n${storyArcContext.slice(0, 600)}`)
  if (existingForeshadows) parts.push(`【已有伏笔】\n${existingForeshadows.slice(0, 500)}`)
  if (outlineSummary) parts.push(`【大纲摘要】\n${outlineSummary.slice(0, 500)}`)
  if (worldContext) parts.push(`【世界观】\n${worldContext.slice(0, 300)}`)

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: parts.join('\n\n') + '\n\n请建议新的伏笔：' },
  ]
}

export function parseForeshadowSuggestions(raw: string): Array<{
  name: string
  type: string
  description: string
  importance: number
  suggestedPlantChapter: string
  suggestedResolveChapter: string
}> {
  const trimmed = raw.trim()
  let jsonStr = trimmed

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) jsonStr = fenceMatch[1].trim()

  const arrStart = jsonStr.indexOf('[')
  const arrEnd = jsonStr.lastIndexOf(']')
  if (arrStart === -1 || arrEnd === -1) return []

  try {
    const parsed = JSON.parse(jsonStr.slice(arrStart, arrEnd + 1))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item: Record<string, unknown>) => item.name && item.type && item.description)
  } catch {
    return []
  }
}
