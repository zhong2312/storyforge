import { nanoid } from 'nanoid'
import { projectLocatorKey, type ProjectLocator } from '../../../storage/ports'
import type { AdoptInput } from '../../../registry/types'

export interface AdoptionPlanPreview {
  readonly target: string
  readonly mode: AdoptInput['mode']
  readonly canonicalFields: readonly string[]
  readonly aliasMapped: readonly { from: string; to: string }[]
  readonly unknownFields: readonly string[]
  readonly itemCount: number
}

export interface AdoptionPlan {
  readonly planId: string
  readonly approvalId: string
  readonly planHash: string
  readonly project: ProjectLocator
  readonly baseRevision: string
  readonly expiresAt: number
  readonly input: AdoptInput
  readonly preview: AdoptionPlanPreview
}

export class AdoptionPlanStore {
  readonly #plans = new Map<string, AdoptionPlan>()

  async create(args: {
    project: ProjectLocator
    baseRevision: string
    input: AdoptInput
    preview: AdoptionPlanPreview
    ttlMs?: number
  }): Promise<AdoptionPlan> {
    const planId = nanoid()
    const approvalId = nanoid()
    const expiresAt = Date.now() + (args.ttlMs ?? 10 * 60 * 1000)
    const planHash = await sha256(stableStringify({
      planId,
      approvalId,
      project: projectLocatorKey(args.project),
      baseRevision: args.baseRevision,
      expiresAt,
      input: args.input,
    }))
    const plan = deepFreeze(structuredClone({
      planId,
      approvalId,
      planHash,
      project: args.project,
      baseRevision: args.baseRevision,
      expiresAt,
      input: args.input,
      preview: args.preview,
    }))
    this.#plans.set(planId, plan)
    return structuredClone(plan)
  }

  get(planId: string): AdoptionPlan | undefined {
    const plan = this.#plans.get(planId)
    if (!plan) return undefined
    if (plan.expiresAt <= Date.now()) {
      this.#plans.delete(planId)
      return undefined
    }
    return structuredClone(plan)
  }

  consume(planId: string): void {
    this.#plans.delete(planId)
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}
