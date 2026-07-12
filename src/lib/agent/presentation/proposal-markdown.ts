import { CHARACTER_DIMENSIONS } from '../../character/character-dimensions'
import type { FieldSpec } from '../../registry/types'
import { FIELD_BY_TARGET } from '../../registry/field-registry'
import type { AgentChangePreview } from '../events/agent-events'
import { CONFLICT_PRIORITY_LABELS, WORLD_RULE_TREE, type WorldRuleNodeDef } from '../../types/world-rules'

const CHARACTER_BASE_FIELDS = ['name', 'role', 'roleWeight', 'moralAxis', 'orderAxis'] as const

const CHARACTER_BASE_LABELS: Readonly<Record<string, string>> = {
  name: '姓名',
  role: '角色定位',
  roleWeight: '戏份权重',
  moralAxis: '道德倾向',
  orderAxis: '秩序倾向',
}

const ENUM_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  role: {
    protagonist: '主角', antagonist: '反派', supporting: '重要配角',
    minor: '次要角色', npc: 'NPC', extra: '路人',
  },
  roleWeight: { main: '主要角色', secondary: '次要角色', npc: 'NPC', extra: '路人' },
  moralAxis: { good: '善良', neutral: '中立', evil: '邪恶' },
  orderAxis: { lawful: '守序', neutral: '中立', chaotic: '混乱' },
}

const TARGET_LABELS: Readonly<Record<string, string>> = {
  characters: '角色',
  chapters: '章节',
  outlineNodes: '大纲',
  worldviews: '世界观',
  worldRulesProfiles: '真实与幻想',
  storyCores: '故事核心',
}

export function proposalPreviewMarkdown(preview: AgentChangePreview | undefined): string {
  if (!preview || preview.target === 'chapters') return ''
  const rawItems = Array.isArray(preview.data) ? preview.data : [preview.data]
  const items = rawItems.map(item => normalizeItem(preview.target, item))
  if (preview.target === 'characters') return characterPreviewMarkdown(items)
  if (preview.target === 'worldRulesProfiles') return worldRulesPreviewMarkdown(items)
  return genericPreviewMarkdown(preview.target, items)
}

export function proposalApprovalTitle(preview: AgentChangePreview | undefined): string {
  if (preview?.target === 'chapters') return '正文已生成，是否采纳？'
  const label = TARGET_LABELS[preview?.target ?? ''] ?? '变更'
  return `${label}内容已生成，是否采纳？`
}

function characterPreviewMarkdown(items: readonly Readonly<Record<string, unknown>>[]): string {
  return items.map((item, index) => {
    const name = displayValue('name', item.name) || `未命名角色 ${index + 1}`
    const sections: string[] = [`## ${escapeHeading(name)}`]
    const base = CHARACTER_BASE_FIELDS
      .filter(field => hasDisplayValue(item[field]))
      .map(field => markdownField(CHARACTER_BASE_LABELS[field], displayValue(field, item[field])))
    if (base.length > 0) sections.push(`### 基本定位\n\n${base.join('\n')}`)

    const shown = new Set<string>(CHARACTER_BASE_FIELDS)
    for (const group of [...new Set(CHARACTER_DIMENSIONS.map(dimension => dimension.group))]) {
      const fields = CHARACTER_DIMENSIONS
        .filter(dimension => dimension.group === group && hasDisplayValue(item[dimension.key]))
        .map(dimension => {
          shown.add(dimension.key)
          return markdownField(dimension.label, displayValue(dimension.key, item[dimension.key]))
        })
      if (fields.length > 0) sections.push(`### ${group}\n\n${fields.join('\n')}`)
    }

    const remaining = Object.entries(item)
      .filter(([field, value]) => !shown.has(field) && hasDisplayValue(value) && !isSystemField(field))
      .map(([field, value]) => markdownField(fieldLabel('characters', field), displayValue(field, value)))
    if (remaining.length > 0) sections.push(`### 其他属性\n\n${remaining.join('\n')}`)
    return sections.join('\n\n')
  }).join('\n\n---\n\n')
}

function genericPreviewMarkdown(
  target: string,
  items: readonly Readonly<Record<string, unknown>>[],
): string {
  const targetLabel = TARGET_LABELS[target] ?? target
  return items.map((item, index) => {
    const title = displayValue('name', item.name)
      || displayValue('title', item.title)
      || `${targetLabel} ${index + 1}`
    const fields = Object.entries(item)
      .filter(([field, value]) => !isSystemField(field) && hasDisplayValue(value))
      .map(([field, value]) => markdownField(fieldLabel(target, field), displayValue(field, value)))
    return `## ${escapeHeading(title)}\n\n${fields.join('\n')}`
  }).join('\n\n---\n\n')
}

function worldRulesPreviewMarkdown(
  items: readonly Readonly<Record<string, unknown>>[],
): string {
  const paths = worldRuleNodePaths(WORLD_RULE_TREE)
  return items.map(item => {
    const sections = ['## 真实与幻想']
    if (isPlainRecord(item.entries)) {
      for (const [nodeId, rawEntry] of Object.entries(item.entries)) {
        const heading = `${paths.get(nodeId) ?? nodeId}（${nodeId}）`
        if (rawEntry == null) {
          sections.push(`### ${escapeHeading(heading)}\n\n- **操作**：删除该维度规则`)
          continue
        }
        if (!isPlainRecord(rawEntry)) continue
        const fields: string[] = []
        const historical = rawEntry.historicalAnchors ?? rawEntry['取自真实'] ?? rawEntry['史实锚点']
        const fictional = rawEntry.fictionalAdaptations ?? rawEntry['架空改造'] ?? rawEntry['虚构设定']
        const priority = rawEntry.priority ?? rawEntry['冲突优先级'] ?? rawEntry['冲突时优先']
        if (hasDisplayValue(historical)) fields.push(markdownField('取自真实', displayValue('', historical)))
        if (hasDisplayValue(fictional)) fields.push(markdownField('架空改造', displayValue('', fictional)))
        if (hasDisplayValue(priority)) {
          const label = CONFLICT_PRIORITY_LABELS[String(priority) as keyof typeof CONFLICT_PRIORITY_LABELS]
            ?? displayValue('', priority)
          fields.push(markdownField('冲突时优先', label))
        }
        if (fields.length > 0) sections.push(`### ${escapeHeading(heading)}\n\n${fields.join('\n')}`)
      }
    }
    if (hasDisplayValue(item.globalNote)) {
      sections.push(`### 全局补充说明\n\n${displayValue('', item.globalNote)}`)
    }
    return sections.join('\n\n')
  }).join('\n\n---\n\n')
}

function worldRuleNodePaths(
  nodes: readonly WorldRuleNodeDef[],
  parentLabel?: string,
  paths = new Map<string, string>(),
): Map<string, string> {
  for (const node of nodes) {
    paths.set(node.id, parentLabel ? `${parentLabel} / ${node.label}` : `${node.label} / 总览`)
    worldRuleNodePaths(node.children ?? [], node.label, paths)
  }
  return paths
}

function normalizeItem(target: string, item: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const fields = FIELD_BY_TARGET.get(target) ?? []
  const canonicalByInput = new Map<string, string>()
  for (const field of fields) {
    canonicalByInput.set(field.field, field.field)
    for (const alias of field.aliases ?? []) canonicalByInput.set(alias, field.field)
  }
  const normalized: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(item)) {
    normalized[canonicalByInput.get(field) ?? field] = value
  }
  return normalized
}

function fieldLabel(target: string, field: string): string {
  if (target === 'characters' && CHARACTER_BASE_LABELS[field]) return CHARACTER_BASE_LABELS[field]
  const dimension = CHARACTER_DIMENSIONS.find(item => item.key === field)
  if (target === 'characters' && dimension) return dimension.label
  const spec = (FIELD_BY_TARGET.get(target) ?? []).find(item => item.field === field)
  return spec?.label || chineseAlias(spec) || field
}

function chineseAlias(spec: FieldSpec | undefined): string | undefined {
  return spec?.aliases?.find(alias => /[\u3400-\u9fff]/.test(alias))
}

function markdownField(label: string, value: string): string {
  const indented = value.replace(/\r\n/g, '\n').replace(/\n/g, '\n  ')
  return `- **${label}**：${indented}`
}

function displayValue(field: string, value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return ENUM_LABELS[field]?.[value] ?? value.trim()
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(item => displayValue(field, item)).filter(Boolean).join('、')
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function hasDisplayValue(value: unknown): boolean {
  return displayValue('', value).length > 0
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isSystemField(field: string): boolean {
  return ['id', 'projectId', 'worldGroupId', 'homeWorldGroupId', 'createdAt', 'updatedAt'].includes(field)
}

function escapeHeading(value: string): string {
  return value.replace(/[\r\n#]/g, ' ').trim()
}
