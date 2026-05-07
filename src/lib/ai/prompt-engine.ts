import type { ChatMessage } from '../types'
import type { PromptTemplate, PromptVariableContext } from '../types/prompt'

/**
 * 渲染提示词模板。
 *
 * 支持语法：
 *   {{var}}              字符串替换；缺失时替换为空串并 console.warn
 *   {{#if var}}...{{/if}} 条件块；var 真值且非空字符串时保留块内容，否则去掉整块
 *
 * 不支持嵌套 {{#if}}（Phase 1 内置模板没有这个需求；后续按需扩展）。
 *
 * Phase 12 升级：模板的 parameters 字段会自动注入到 ctx：
 *   - 每个 parameter.key 直接作为 {{key}} 变量
 *   - 每个 parameter 同时生成 {{usesKey}} 标志：optional=true 且参数值有效时为 '1'，
 *     用 {{#if usesXxx}}...{{/if}} 包住可选段落
 *
 * Phase 12 升级：parameterValues 用户运行时覆盖参数值（不写回模板）。
 */
export function renderPrompt(
  template: PromptTemplate,
  ctx: PromptVariableContext,
  options?: {
    /** 运行时覆盖参数值（user 在创作区临时调整时用） */
    parameterValues?: Record<string, unknown>
    /** 运行时覆盖 system / user 模板（临时微调，不写回） */
    overrides?: { systemPrompt?: string; userPromptTemplate?: string }
  },
): { messages: ChatMessage[]; modelOverride?: { temperature?: number; maxTokens?: number } } {
  // 1. 把模板参数注入到 ctx（运行时值覆盖默认值）
  const enriched: PromptVariableContext = { ...ctx }
  if (template.parameters && template.parameters.length > 0) {
    for (const p of template.parameters) {
      const userVal = options?.parameterValues?.[p.key]
      const usesKey = `uses${p.key.charAt(0).toUpperCase()}${p.key.slice(1)}`

      // optional 且用户显式关闭：不注入参数变量、usesXxx 设为空（条件块隐藏）
      if (p.optional && options?.parameterValues && (userVal === undefined || userVal === null || userVal === '')) {
        enriched[p.key] = ''
        enriched[usesKey] = ''
        continue
      }

      // 注入参数值（用户值优先，否则默认值）
      const v = userVal !== undefined ? userVal : p.default
      enriched[p.key] = v as string | number
      enriched[usesKey] = (v === '' || v === false || v === null || v === undefined) ? '' : '1'
    }
  }

  const sysSrc = options?.overrides?.systemPrompt ?? template.systemPrompt
  const userSrc = options?.overrides?.userPromptTemplate ?? template.userPromptTemplate

  const userContent = renderString(userSrc, enriched, template.moduleKey)
  const systemContent = renderString(sysSrc, enriched, template.moduleKey)

  const messages: ChatMessage[] = []
  if (systemContent.trim()) {
    messages.push({ role: 'system', content: systemContent })
  }
  messages.push({ role: 'user', content: userContent })

  return {
    messages,
    modelOverride: template.modelOverride,
  }
}

function renderString(tpl: string, ctx: PromptVariableContext, moduleKey: string): string {
  // 1. 先处理 {{#if var}}...{{/if}} 块
  let out = tpl.replace(
    /\{\{#if\s+([a-zA-Z0-9_]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, varName: string, block: string) => {
      const v = ctx[varName]
      const truthy =
        v !== undefined &&
        v !== null &&
        !(typeof v === 'string' && v.trim() === '')
      return truthy ? block : ''
    },
  )

  // 2. 处理 {{var}} 替换
  out = out.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, varName: string) => {
    const v = ctx[varName]
    if (v === undefined || v === null) {
      console.warn(`[prompt-engine] missing variable {{${varName}}} in module ${moduleKey}`)
      return ''
    }
    return String(v)
  })

  return out
}
