import type { PromptExample, PromptTemplate } from '../../types/prompt'
import type { AgentPromptProfile } from '../runtime/agent-runtime-port'

interface AgentPromptProfileOptions {
  readonly variables?: Readonly<Record<string, unknown>>
  readonly parameterValues?: Readonly<Record<string, unknown>>
  readonly overrides?: {
    readonly systemPrompt?: string
    readonly userPromptTemplate?: string
  }
}

export function createAgentPromptProfile(
  template: PromptTemplate,
  options: AgentPromptProfileOptions = {},
): AgentPromptProfile {
  const values: Record<string, string | number | boolean> = {}
  const parameters: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(options.variables ?? {})) {
    if (isPromptValue(value)) values[key] = value
  }

  const hasParameterOverrides = options.parameterValues != null
  for (const parameter of template.parameters ?? []) {
    const override = options.parameterValues?.[parameter.key]
    const enabled = !parameter.optional
      || !hasParameterOverrides
      || (override !== undefined && override !== null && override !== '')
    const value = override !== undefined ? override : parameter.default
    const cap = parameter.key.charAt(0).toUpperCase() + parameter.key.slice(1)
    values[parameter.key] = enabled && isPromptValue(value) ? value : ''
    parameters[parameter.key] = values[parameter.key]
    values[`uses${cap}`] = enabled && isTruthyPromptValue(value) ? '1' : ''
    values[`notUses${cap}`] = enabled && isTruthyPromptValue(value) ? '' : '1'
  }

  return {
    moduleKey: template.moduleKey,
    name: template.name,
    systemPrompt: renderKnownVariables(
      options.overrides?.systemPrompt ?? template.systemPrompt,
      values,
    ),
    userPromptTemplate: renderKnownVariables(
      options.overrides?.userPromptTemplate ?? template.userPromptTemplate,
      values,
    ),
    parameterValues: Object.keys(parameters).length > 0 ? parameters : undefined,
    goodExamples: exampleTexts(template.examples?.good, 3),
    badExamples: exampleTexts(template.examples?.bad, 2),
    modelOverride: template.modelOverride,
  }
}

function renderKnownVariables(
  template: string,
  values: Readonly<Record<string, string | number | boolean>>,
): string {
  const withConditions = template.replace(
    /\{\{#if\s+([a-zA-Z0-9_]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, variable: string, block: string) => {
      if (!hasOwn(values, variable)) return block
      return isTruthyPromptValue(values[variable]) ? block : ''
    },
  )
  return withConditions.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (placeholder, variable: string) => hasOwn(values, variable)
      ? String(values[variable])
      : placeholder,
  )
}

function exampleTexts(
  examples: readonly PromptExample[] | undefined,
  limit: number,
): string[] | undefined {
  const texts = (examples ?? []).map(example => example.text.trim()).filter(Boolean).slice(0, limit)
  return texts.length > 0 ? texts : undefined
}

function isPromptValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function isTruthyPromptValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && value !== false
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}
