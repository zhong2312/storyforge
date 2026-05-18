/** AI 提供商 */
export type AIProvider =
  | 'deepseek'
  | 'openai'
  | 'qwen'
  | 'doubao'
  | 'minimax'
  | 'glm'
  | 'wenxin'
  | 'gemini'
  | 'poe'
  | 'kimi'
  | 'claude'
  | 'ollama'
  | 'custom'

/** AI 配置 */
export interface AIConfig {
  provider: AIProvider
  apiKey: string
  model: string
  baseUrl: string
  temperature: number
  maxTokens: number
}

/** 聊天消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** AI 错误 */
export class AIError extends Error {
  status: number
  body: string

  constructor(status: number, body: string) {
    super(`AI API Error (${status}): ${body}`)
    this.name = 'AIError'
    this.status = status
    this.body = body
  }
}

/** 各 provider 的可选模型列表（有下拉菜单的 provider 才需要配） */
export const PROVIDER_MODELS: Record<string, { value: string; label: string; desc?: string }[]> = {
  deepseek: [
    { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', desc: '快速，性价比高' },
    { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', desc: '最强，支持深度思考' },
  ],
  // Gemini 模型列表（2026-05-11 通过 Google API 实际拉取校验）
  gemini: [
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Preview)', desc: '最新最强预览版' },
    { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro (Preview)', desc: '3 代 Pro 预览版' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)', desc: '3 代 Flash，快速' },
    { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', desc: '轻量快速' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', desc: '稳定版，支持思考' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', desc: '稳定版，免费额度高' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', desc: '轻量稳定版' },
    { value: 'gemini-pro-latest', label: 'Gemini Pro Latest', desc: '自动跟随最新 Pro' },
    { value: 'gemini-flash-latest', label: 'Gemini Flash Latest', desc: '自动跟随最新 Flash' },
    { value: 'gemini-flash-lite-latest', label: 'Gemini Flash-Lite Latest', desc: '自动跟随最新 Flash-Lite' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', desc: '老版稳定' },
  ],
  poe: [
    { value: 'GPT-4o', label: 'GPT-4o' },
    { value: 'Claude-Sonnet-4.6', label: 'Claude Sonnet 4.6' },
    { value: 'Claude-Opus-4.7', label: 'Claude Opus 4.7' },
    { value: 'Gemini-3.1-Pro', label: 'Gemini 3.1 Pro' },
    { value: 'GPT-5.4', label: 'GPT-5.4' },
    { value: 'GLM-5.1-FM', label: 'GLM 5.1 FM' },
  ],
}

/** 提供商预设 */
export const PROVIDER_PRESETS: Record<string, Partial<AIConfig>> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
  },
  doubao: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-pro-32k',
  },
  minimax: {
    baseUrl: 'https://api.minimax.chat/v1',
    model: 'MiniMax-Text-01',
  },
  glm: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
  },
  wenxin: {
    baseUrl: 'https://qianfan.baidubce.com/v2',
    model: 'ernie-4.0-8k',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3-flash-preview',
  },
  poe: {
    baseUrl: 'https://api.poe.com/v1',
    model: 'GPT-4o',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
  },
  claude: {
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    apiKey: 'ollama',
  },
}
