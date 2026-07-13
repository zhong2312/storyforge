import type {
  GenerationNode,
  GenerationNodeRunResult,
} from './types'

export interface RunGenerationNodeOptions<TInput> {
  /** UI 已经完成发送前预览时，可直接传入确认后的输入，避免重复装配上下文。 */
  preparedInput?: TInput
  /** 返回 null 表示用户取消本节点。 */
  editInput?: (input: TInput) => Promise<TInput | null>
}

function cloneEditableInput<TInput>(input: TInput): TInput {
  try {
    return structuredClone(input)
  } catch {
    return input
  }
}

export async function runGenerationNode<TContext, TInput, TOutput>(
  node: GenerationNode<TContext, TInput, TOutput>,
  context: TContext,
  options: RunGenerationNodeOptions<TInput> = {},
): Promise<GenerationNodeRunResult<TInput, TOutput> | null> {
  const assembledInput = options.preparedInput ?? await node.assembleInput(context)
  const input = node.editableInput && options.editInput
    ? await options.editInput(cloneEditableInput(assembledInput))
    : assembledInput
  if (input == null) return null

  const output = await node.run(input, context)
  const gate = node.gate ? await node.gate(output, context) : null
  return { input, output, gate }
}
