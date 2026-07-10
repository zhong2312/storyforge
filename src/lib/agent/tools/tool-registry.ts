import type {
  StoryForgeTool,
  ToolAvailability,
  ToolExecutionContext,
  ToolRisk,
  ToolScope,
} from './tool-types'

function supportsPlatform(
  availability: ToolAvailability,
  platform: ToolExecutionContext['platform'],
): boolean {
  return availability === 'both' || availability === platform
}

function hasScopes(
  required: readonly ToolScope[],
  granted: ReadonlySet<ToolScope>,
): boolean {
  return required.every(scope => granted.has(scope))
}

interface RegisteredToolDescriptor extends StoryForgeTool {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
  readonly risk: ToolRisk
  readonly availability: ToolAvailability
  readonly requiredScopes: readonly ToolScope[]
  readonly execute: (this: void, context: ToolExecutionContext, input: unknown) => Promise<unknown>
  readonly summarizeInput?: (this: void, input: unknown) => string
  readonly summarizeOutput?: (this: void, output: unknown) => string
}

function freezeRecursively(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value

  for (const child of Object.values(value)) {
    freezeRecursively(child)
  }

  return Object.freeze(value)
}

function snapshotSchema(
  inputSchema: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return freezeRecursively(structuredClone(inputSchema)) as Readonly<Record<string, unknown>>
}

function createDescriptor<Input, Output>(
  tool: StoryForgeTool<Input, Output>,
): RegisteredToolDescriptor {
  const execute = tool.execute
  const summarizeInput = tool.summarizeInput
  const summarizeOutput = tool.summarizeOutput

  return Object.freeze({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: snapshotSchema(tool.inputSchema),
    risk: tool.risk,
    availability: tool.availability,
    requiredScopes: Object.freeze([...tool.requiredScopes]),
    execute: (context: ToolExecutionContext, input: unknown): Promise<unknown> =>
      execute(context, input as Input),
    ...(summarizeInput === undefined ? {} : {
      summarizeInput: (input: unknown): string => summarizeInput(input as Input),
    }),
    ...(summarizeOutput === undefined ? {} : {
      summarizeOutput: (output: unknown): string => summarizeOutput(output as Output),
    }),
  })
}

export class ToolRegistry {
  readonly #tools = new Map<string, RegisteredToolDescriptor>()

  register<Input, Output>(tool: StoryForgeTool<Input, Output>): void {
    const descriptor = createDescriptor(tool)
    if (this.#tools.has(descriptor.name)) {
      throw new Error(`[tool-registry] duplicate tool ${descriptor.name}`)
    }

    this.#tools.set(descriptor.name, descriptor)
  }

  get(name: string): StoryForgeTool | undefined {
    return this.#tools.get(name)
  }

  listAvailable(context: ToolExecutionContext): StoryForgeTool[] {
    return Array.from(this.#tools.values())
      .filter(descriptor =>
        supportsPlatform(descriptor.availability, context.platform)
        && hasScopes(descriptor.requiredScopes, context.scopes),
      )
  }

  async execute(
    name: string,
    context: ToolExecutionContext,
    input: unknown,
  ): Promise<unknown> {
    const descriptor = this.#tools.get(name)
    if (!descriptor) {
      throw new Error(`[tool-registry] unknown tool ${name}`)
    }

    if (!supportsPlatform(descriptor.availability, context.platform)
      || !hasScopes(descriptor.requiredScopes, context.scopes)) {
      throw new Error(`[tool-registry] tool ${name} is not available`)
    }

    if (context.signal.aborted) {
      throw new DOMException('Agent run aborted', 'AbortError')
    }

    return descriptor.execute(context, input)
  }
}
