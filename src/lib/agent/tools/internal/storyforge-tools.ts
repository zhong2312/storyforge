import { adopt } from '../../../registry/adopt'
import { assembleContext } from '../../../registry/assemble-context'
import { CONTEXT_SOURCES } from '../../../registry/context-sources'
import { FIELD_BY_TARGET, FIELD_REGISTRY } from '../../../registry/field-registry'
import { projectLocatorKey, type ProjectStoragePort } from '../../../storage/ports'
import type { AdoptInput, FieldSpec } from '../../../registry/types'
import { countWords, htmlToPlainText } from '../../../utils/html'
import type { StoryForgeTool, ToolExecutionContext } from '../tool-types'
import { AdoptionPlanStore, type AdoptionPlanPreview } from './adoption-plan-store'

export interface StoryForgeToolDependencies {
  readonly storage: ProjectStoragePort
  readonly plans?: AdoptionPlanStore
}

export function createStoryForgeTools(
  dependencies: StoryForgeToolDependencies,
): readonly StoryForgeTool[] {
  const plans = dependencies.plans ?? new AdoptionPlanStore()
  return Object.freeze([
    createSettingsCatalogTool(),
    createContextReadTool(dependencies.storage),
    createChangeProposeTool(dependencies.storage, plans),
    createChangeCommitTool(dependencies.storage, plans),
  ])
}

function createSettingsCatalogTool(): StoryForgeTool<Record<string, never>, unknown> {
  return {
    name: 'storyforge.settings.catalog',
    title: `设定能力目录（${CONTEXT_SOURCES.length} 个读取源 / ${FIELD_BY_TARGET.size} 个写入目标）`,
    description: '列出注册表中可读取的上下文源和可修改的设定字段。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'read',
    availability: 'both',
    requiredScopes: ['project:read'],
    summarizeOutput: output => `已列出 ${Reflect.get(output as object, 'readSources')?.length ?? 0} 个读取源`,
    async execute() {
      return {
        readSources: CONTEXT_SOURCES.map(source => ({
          key: source.key,
          label: source.label,
          scope: source.scope,
          layer: source.layer,
          requiresWorldGroupId: Boolean(source.requiresWorldGroupId),
          requiresOutlineNodeId: Boolean(source.requiresOutlineNodeId),
          requiresChapterId: Boolean(source.requiresChapterId),
        })),
        writeTargets: Array.from(FIELD_BY_TARGET, ([target, fields]) => ({
          target,
          fields: fields.map(toFieldDescriptor),
        })),
      }
    },
  }
}

function createContextReadTool(storage: ProjectStoragePort): StoryForgeTool<{
  sourceKeys: string[]
  manualSourceText?: string
  worldGroupId?: number | null
  outlineNodeId?: number
  chapterId?: number
  chapterOrdinal?: number
}, unknown> {
  return {
    name: 'storyforge.context.read',
    title: '读取项目设定',
    description: '通过 CONTEXT_SOURCES 和 assembleContext 读取并裁剪项目设定。',
    inputSchema: {
      type: 'object',
      properties: {
        sourceKeys: { type: 'array', items: { type: 'string' }, minItems: 1 },
        manualSourceText: { type: 'string' },
        worldGroupId: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        outlineNodeId: { type: 'number', minimum: 1 },
        chapterId: { type: 'number', minimum: 1 },
        chapterOrdinal: { type: 'number', minimum: 1 },
      },
      required: ['sourceKeys'],
      additionalProperties: false,
    },
    risk: 'read',
    availability: 'both',
    requiredScopes: ['project:read'],
    summarizeInput: input => `读取设定：${input.sourceKeys.join('、')}`,
    summarizeOutput: output => `已读取 ${(output as { included?: string[] }).included?.length ?? 0} 个设定源`,
    async execute(context, input) {
      assertStorageBinding(storage, context)
      const projectId = await resolveStorageProjectId(storage)
      const unknown = input.sourceKeys.filter(key => !CONTEXT_SOURCES.some(source => source.key === key))
      if (unknown.length) throw new Error(`[storyforge.context.read] unknown sources: ${unknown.join(', ')}`)
      const worldGroupId = resolveReadScope('worldGroupId', context.worldGroupId, input.worldGroupId)
      const outlineNodeId = resolveReadScope('outlineNodeId', context.outlineNodeId, input.outlineNodeId)
      const chapterId = resolveReadScope('chapterId', context.chapterId, input.chapterId)
      const assembled = await assembleContext({
        projectId,
        worldGroupId,
        outlineNodeId,
        chapterId,
        chapterOrdinal: input.chapterOrdinal,
        sourceKeys: input.sourceKeys,
        manualSourceText: input.manualSourceText,
        storage,
      })
      return {
        ...assembled,
        resolvedScope: { worldGroupId, outlineNodeId, chapterId, chapterOrdinal: input.chapterOrdinal },
      }
    },
  }
}

function resolveReadScope<T extends number | null>(
  field: string,
  hostValue: T | undefined,
  requestedValue: T | undefined,
): T | undefined {
  if (hostValue !== undefined && requestedValue !== undefined && hostValue !== requestedValue) {
    throw new Error(`[storyforge.context.read] ${field} is locked by host scope`)
  }
  return hostValue !== undefined ? hostValue : requestedValue
}

function createChangeProposeTool(
  storage: ProjectStoragePort,
  plans: AdoptionPlanStore,
): StoryForgeTool<Omit<AdoptInput, 'projectId' | 'worldGroupId'>, unknown> {
  return {
    name: 'storyforge.change.propose',
    title: '生成设定变更方案',
    description: '按 FIELD_REGISTRY 校验设定变更并生成审批计划，不写入项目。',
    inputSchema: adoptionInputSchema(),
    risk: 'write',
    availability: 'both',
    requiredScopes: ['project:read'],
    summarizeInput: input => input.target ? `计划修改 ${input.target}` : '校验变更提案',
    summarizeOutput: output => `已生成变更计划 ${(output as { planId?: string }).planId ?? ''}`,
    async execute(context, input) {
      assertStorageBinding(storage, context)
      const projectId = await resolveStorageProjectId(storage)
      const adoptionInput = normalizeDerivedFields({
        ...structuredClone(input),
        projectId,
        worldGroupId: context.worldGroupId,
      })
      const preview = previewAdoption(adoptionInput)
      if (!FIELD_BY_TARGET.has(adoptionInput.target)) {
        throw new Error(`[storyforge.change.propose] target is not registered: ${adoptionInput.target}`)
      }
      return await plans.create({
        project: context.project,
        baseRevision: await storage.getRevision(),
        input: adoptionInput,
        preview,
      })
    },
  }
}

function normalizeDerivedFields(input: AdoptInput): AdoptInput {
  if (input.target !== 'chapters' || input.mode === 'append') return input

  const normalizeItem = (item: Record<string, unknown>): Record<string, unknown> => {
    if (typeof item.content !== 'string') return item
    return {
      ...item,
      wordCount: countWords(htmlToPlainText(item.content)),
    }
  }

  return {
    ...input,
    data: Array.isArray(input.data)
      ? input.data.map(normalizeItem)
      : normalizeItem(input.data),
  }
}

function createChangeCommitTool(
  storage: ProjectStoragePort,
  plans: AdoptionPlanStore,
): StoryForgeTool<{ planId: string }, unknown> {
  return {
    name: 'storyforge.change.commit',
    title: '提交已批准的设定变更',
    description: '验证审批、项目和 revision 后，通过 adopt() 原子写入已批准计划。',
    inputSchema: {
      type: 'object',
      properties: { planId: { type: 'string', minLength: 1 } },
      required: ['planId'],
      additionalProperties: false,
    },
    risk: 'write',
    availability: 'both',
    requiredScopes: ['project:write'],
    summarizeInput: input => `提交变更计划 ${input.planId}`,
    summarizeOutput: output => `已写入 ${(output as { written?: unknown[] }).written?.length ?? 0} 条变更`,
    async execute(context, input) {
      assertStorageBinding(storage, context)
      const plan = plans.get(input.planId)
      if (!plan) throw new Error(`[storyforge.change.commit] plan missing or expired: ${input.planId}`)
      if (projectLocatorKey(plan.project) !== projectLocatorKey(context.project)) {
        throw new Error('[storyforge.change.commit] project mismatch')
      }
      if (!context.approval
        || context.approval.approvalId !== plan.approvalId
        || context.approval.planHash !== plan.planHash) {
        throw new Error('[storyforge.change.commit] matching approval is required')
      }
      if (await storage.getRevision() !== plan.baseRevision) {
        throw new Error('[storyforge.change.commit] project revision changed; create a new plan')
      }
      const result = await adopt(plan.input, { storage })
      plans.consume(plan.planId)
      return result
    },
  }
}

async function resolveStorageProjectId(storage: ProjectStoragePort): Promise<number> {
  if (storage.locator.backend === 'dexie') return storage.locator.projectId
  const projects = await storage.table('projects').list({ limit: 2 })
  if (projects.length !== 1 || projects[0].id == null) {
    throw new Error('[storyforge-tools] local-folder project must contain exactly one project record')
  }
  return projects[0].id
}

function assertStorageBinding(storage: ProjectStoragePort, context: ToolExecutionContext): void {
  if (projectLocatorKey(storage.locator) !== projectLocatorKey(context.project)) {
    throw new Error('[storyforge-tools] storage project mismatch')
  }
}

function previewAdoption(input: AdoptInput): AdoptionPlanPreview {
  const fieldSpecs = FIELD_BY_TARGET.get(input.target) ?? []
  const byName = new Map(fieldSpecs.map(field => [field.field, field] as const))
  const byAlias = new Map<string, FieldSpec>()
  for (const field of fieldSpecs) for (const alias of field.aliases ?? []) byAlias.set(alias, field)
  const aliasMapped: { from: string; to: string }[] = []
  const unknownFields = new Set<string>()
  const canonicalFields = new Set<string>()
  const items = Array.isArray(input.data) ? input.data : [input.data]
  for (const item of items) {
    for (const key of Object.keys(item)) {
      const direct = byName.get(key)
      const alias = byAlias.get(key)
      if (direct) canonicalFields.add(direct.field)
      else if (alias) {
        canonicalFields.add(alias.field)
        aliasMapped.push({ from: key, to: alias.field })
      } else unknownFields.add(key)
    }
  }
  return {
    target: input.target,
    mode: input.mode,
    canonicalFields: [...canonicalFields],
    aliasMapped,
    unknownFields: [...unknownFields],
    itemCount: items.length,
  }
}

function toFieldDescriptor(field: FieldSpec): Record<string, unknown> {
  return {
    field: field.field,
    label: field.label,
    type: field.type,
    aliases: field.aliases ?? [],
    enums: field.enums,
    worldScoped: Boolean(field.worldScoped),
  }
}

function adoptionInputSchema(): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    properties: {
      target: { type: 'string', enum: [...new Set(FIELD_REGISTRY.map(field => field.target))] },
      mode: { type: 'string', enum: ['replace', 'append', 'add', 'add-many', 'merge-diffs'] },
      recordId: { type: 'number' },
      data: { oneOf: [{ type: 'object' }, { type: 'array', items: { type: 'object' } }] },
    },
    required: ['target', 'mode', 'data'],
    additionalProperties: false,
  }
}
