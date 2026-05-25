/**
 * 创作方法论引导 — Phase E3
 *
 * 定义多种创作方法论，选择后在大纲生成时按阶段指导 AI。
 */

export interface MethodologyStage {
  title: string
  description: string
  /** 占全书的百分比 */
  percentage: number
}

export interface Methodology {
  id: string
  name: string
  description: string
  stages: MethodologyStage[]
  /** 注入大纲生成 prompt 的方法论指导 */
  outlineGuidance: string
}

export const METHODOLOGIES: Methodology[] = [
  {
    id: 'snowflake',
    name: '雪花法',
    description: '从一句话核心展开，逐步细化到完整大纲',
    stages: [
      { title: '一句话核心', description: '用一句话概括整个故事', percentage: 5 },
      { title: '一段话扩展', description: '将核心扩展为一段话（约5句）', percentage: 10 },
      { title: '角色概要', description: '为每个主要角色写一页概要', percentage: 15 },
      { title: '段落扩展', description: '将每句话扩展为一段话', percentage: 20 },
      { title: '场景列表', description: '列出每章的场景清单', percentage: 25 },
      { title: '初稿', description: '基于场景列表写出完整初稿', percentage: 25 },
    ],
    outlineGuidance: `请按"雪花法"规划大纲：
1. 先确定故事的一句话核心
2. 围绕核心展开主要矛盾和转折
3. 每个卷/章节应能回溯到核心主题
4. 从宏观到微观逐层细化`,
  },
  {
    id: 'hero-journey',
    name: '英雄之旅',
    description: '经典12阶段叙事结构',
    stages: [
      { title: '日常世界', description: '展示主角的日常生活', percentage: 5 },
      { title: '冒险的召唤', description: '打破日常的事件发生', percentage: 5 },
      { title: '拒绝召唤', description: '主角犹豫不决', percentage: 5 },
      { title: '遇到导师', description: '获得指引和帮助', percentage: 5 },
      { title: '跨越门槛', description: '进入冒险的新世界', percentage: 8 },
      { title: '考验与盟友', description: '结识伙伴、面对挑战', percentage: 15 },
      { title: '深入洞穴', description: '接近最危险的核心', percentage: 10 },
      { title: '严峻考验', description: '面对最大的危机', percentage: 12 },
      { title: '回报', description: '获得目标或奖励', percentage: 8 },
      { title: '归途', description: '踏上回归之路', percentage: 10 },
      { title: '复活', description: '最终的考验和蜕变', percentage: 10 },
      { title: '带着万灵丹回归', description: '回到日常，世界因此改变', percentage: 7 },
    ],
    outlineGuidance: `请按"英雄之旅"12阶段规划大纲：
1. 日常→召唤→拒绝→导师→跨越门槛→考验→深入→严峻考验→回报→归途→复活→回归
2. 前1/4是"出发"，中间1/2是"启蒙"，最后1/4是"回归"
3. 主角必须经历内在的蜕变，不只是外在冒险`,
  },
  {
    id: 'three-act',
    name: '三幕式',
    description: '建置25% → 对抗50% → 解决25%',
    stages: [
      { title: '第一幕：建置', description: '介绍角色、世界、核心冲突', percentage: 25 },
      { title: '第二幕：对抗', description: '冲突升级、复杂化、挫折与成长', percentage: 50 },
      { title: '第三幕：解决', description: '高潮对决、冲突解决、新的平衡', percentage: 25 },
    ],
    outlineGuidance: `请按"三幕式"结构规划大纲：
1. 第一幕（25%）：建置世界和人物，在结尾处设置第一转折点
2. 第二幕（50%）：冲突不断升级，中点反转，第二转折点进入最低谷
3. 第三幕（25%）：高潮对决，解决核心冲突，展示人物成长`,
  },
  {
    id: 'kishotenketsu',
    name: '起承转合',
    description: '东方传统四段式结构',
    stages: [
      { title: '起：引入', description: '建立背景、介绍人物、提出问题', percentage: 25 },
      { title: '承：发展', description: '承接引入、深化情节、铺垫伏笔', percentage: 25 },
      { title: '转：转折', description: '出人意料的变化、视角反转', percentage: 25 },
      { title: '合：收束', description: '整合前面的元素、揭示主题', percentage: 25 },
    ],
    outlineGuidance: `请按"起承转合"结构规划大纲：
1. 起：自然引入故事，建立基调
2. 承：承接前文，渐入佳境，铺设线索
3. 转：出人意料的转折，让故事进入新维度
4. 合：收束所有线索，升华主题`,
  },
  {
    id: 'save-the-cat',
    name: '救猫咪节拍表',
    description: 'Blake Snyder的15个节拍',
    stages: [
      { title: '开场画面', description: '故事开始的第一个画面', percentage: 3 },
      { title: '主题陈述', description: '暗示故事主题', percentage: 3 },
      { title: '铺垫', description: '展示主角的日常世界', percentage: 7 },
      { title: '催化剂', description: '打破日常的事件', percentage: 5 },
      { title: '讨论', description: '主角犹豫是否接受挑战', percentage: 7 },
      { title: '进入第二幕', description: '主角做出决定', percentage: 5 },
      { title: 'B故事', description: '引入副线（通常是爱情线）', percentage: 5 },
      { title: '欢乐游戏', description: '故事的"承诺"段落', percentage: 12 },
      { title: '中点', description: '假胜利或假失败', percentage: 5 },
      { title: '坏人逼近', description: '困难加剧', percentage: 12 },
      { title: '一无所有', description: '主角跌入最低谷', percentage: 5 },
      { title: '灵魂黑夜', description: '主角面对内心', percentage: 8 },
      { title: '进入第三幕', description: '找到解决方案', percentage: 5 },
      { title: '终幕', description: '高潮对决', percentage: 13 },
      { title: '终场画面', description: '与开场对比的结束画面', percentage: 5 },
    ],
    outlineGuidance: `请按"救猫咪节拍表"15个节拍规划大纲，确保每个节拍都有对应的章节段落。
关键节拍：催化剂（约10%处）、中点（约50%处）、一无所有（约75%处）、高潮（约85%处）`,
  },
]

/**
 * 根据 ID 获取方法论
 */
export function getMethodology(id: string): Methodology | undefined {
  return METHODOLOGIES.find(m => m.id === id)
}

/**
 * 获取当前进度所处的阶段
 */
export function getCurrentStage(
  methodologyId: string,
  progressPercent: number,
): MethodologyStage | undefined {
  const meth = getMethodology(methodologyId)
  if (!meth) return undefined

  let cumulative = 0
  for (const stage of meth.stages) {
    cumulative += stage.percentage
    if (progressPercent <= cumulative) return stage
  }
  return meth.stages[meth.stages.length - 1]
}
