export interface GenerationFinding {
  severity: 'info' | 'warning' | 'error'
  message: string
  quote?: string
}

export interface GenerationGateResult {
  passed: boolean
  findings: GenerationFinding[]
}

/**
 * 透明生成流水线的最小执行单元。节点只描述一次受控生成；项目数据读取和
 * 正式写回仍分别由 CONTEXT_SOURCES 与 AdoptionSchema 负责。
 */
export interface GenerationNode<TContext, TInput, TOutput> {
  id: string
  label: string
  description: string
  editableInput: boolean
  assembleInput: (context: TContext) => Promise<TInput>
  run: (input: TInput, context: TContext) => Promise<TOutput>
  gate?: (output: TOutput, context: TContext) => Promise<GenerationGateResult>
  adopt?: (output: TOutput, context: TContext) => Promise<void>
}

export interface GenerationNodeRunResult<TInput, TOutput> {
  input: TInput
  output: TOutput
  gate: GenerationGateResult | null
}
