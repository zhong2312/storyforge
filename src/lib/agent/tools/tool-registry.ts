import type {
  StoryForgeTool,
  ToolAvailability,
  ToolDescriptor,
  ToolExecutionContext,
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

interface RegisteredTool {
  readonly descriptor: ToolDescriptor
  readonly execute: (this: void, context: ToolExecutionContext, input: unknown) => Promise<unknown>
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
): RegisteredTool {
  const execute = tool.execute
  const summarizeInput = tool.summarizeInput
  const summarizeOutput = tool.summarizeOutput
  const descriptor: ToolDescriptor<Input, Output> = Object.freeze({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: snapshotSchema(tool.inputSchema),
    risk: tool.risk,
    availability: tool.availability,
    requiredScopes: Object.freeze([...tool.requiredScopes]),
    ...(summarizeInput === undefined ? {} : {
      summarizeInput: (input: Input): string => summarizeInput(input),
    }),
    ...(summarizeOutput === undefined ? {} : {
      summarizeOutput: (output: Output): string => summarizeOutput(output),
    }),
  })

  return Object.freeze({
    descriptor,
    execute: (context: ToolExecutionContext, input: unknown): Promise<unknown> =>
      execute(context, input as Input),
  })
}

export class ToolRegistry {
  readonly #tools = new Map<string, RegisteredTool>()

  register<Input, Output>(tool: StoryForgeTool<Input, Output>): void {
    const registered = createDescriptor(tool)
    if (this.#tools.has(registered.descriptor.name)) {
      throw new Error(`[tool-registry] duplicate tool ${registered.descriptor.name}`)
    }

    this.#tools.set(registered.descriptor.name, registered)
  }

  get(name: string): ToolDescriptor | undefined {
    return this.#tools.get(name)?.descriptor
  }

  listAvailable(context: ToolExecutionContext): ToolDescriptor[] {
    return Array.from(this.#tools.values())
      .filter(registered =>
        supportsPlatform(registered.descriptor.availability, context.platform)
        && hasScopes(registered.descriptor.requiredScopes, context.scopes),
      )
      .map(registered => registered.descriptor)
  }

  async execute(
    name: string,
    context: ToolExecutionContext,
    input: unknown,
  ): Promise<unknown> {
    const registered = this.#tools.get(name)
    if (!registered) {
      throw new Error(`[tool-registry] unknown tool ${name}`)
    }
    const { descriptor } = registered

    if (!supportsPlatform(descriptor.availability, context.platform)
      || !hasScopes(descriptor.requiredScopes, context.scopes)) {
      throw new Error(`[tool-registry] tool ${name} is not available`)
    }

    if (context.signal.aborted) {
      throw new DOMException('Agent run aborted', 'AbortError')
    }

    return registered.execute(context, input)
  }
}
