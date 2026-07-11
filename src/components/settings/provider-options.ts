import type { AIProvider } from '../../lib/types'

export const PROVIDER_OPTIONS: { value: AIProvider; label: string; cors: boolean; hint: string }[] = [
  { value: 'deepseek', label: 'DeepSeek', cors: false, hint: '获取 Key: platform.deepseek.com → API Keys（需点击下方「切换到本地代理」）' },
  { value: 'qwen', label: '通义千问', cors: true, hint: '获取 Key: dashscope.console.aliyun.com → API-KEY 管理' },
  { value: 'doubao', label: '豆包', cors: false, hint: '获取 Key: console.volcengine.com → 模型推理 → API Key（火山引擎不支持浏览器直连，需点击下方「切换到本地代理」）' },
  { value: 'minimax', label: 'MiniMax', cors: true, hint: '获取 Key: platform.minimaxi.com → API Keys' },
  { value: 'glm', label: '智谱 GLM', cors: true, hint: '获取 Key: open.bigmodel.cn → API Keys' },
  { value: 'wenxin', label: '文心一言', cors: true, hint: '获取 Key: console.bce.baidu.com → 千帆大模型 → API Key' },
  { value: 'gemini', label: 'Gemini', cors: true, hint: '获取 Key: aistudio.google.com → API Keys' },
  { value: 'poe', label: 'Poe', cors: true, hint: '获取 Key: poe.com → Settings → API → API Key' },
  { value: 'openai', label: 'OpenAI', cors: false, hint: '获取 Key: platform.openai.com → API Keys（需点击下方「切换到本地代理」）' },
  { value: 'kimi', label: 'Kimi', cors: false, hint: '获取 Key: platform.moonshot.cn → API Key 管理（需点击下方「切换到本地代理」）' },
  { value: 'claude', label: 'Claude', cors: false, hint: '获取 Key: console.anthropic.com → API Keys（需点击下方「切换到本地代理」）' },
  { value: 'nvidia', label: 'NVIDIA NIM', cors: false, hint: '获取 Key: build.nvidia.com → 登录后获取 API Key（需点击下方「切换到本地代理」）' },
  { value: 'modelscope', label: '魔搭社区', cors: true, hint: '获取 Key: modelscope.cn → 我的 → Access Token' },
  { value: 'agnes', label: 'Agnes AI（免费）', cors: true, hint: '清华系免费全模态 · 获取 Key: platform.agnes-ai.com（若连不上可点下方「切换到本地代理」）' },
  { value: 'longcat', label: 'LongCat（美团）', cors: false, hint: '获取 Key: longcat.chat 平台控制台；OpenAI 兼容接口（若浏览器直连 CORS 失败可切换本地代理）' },
  { value: 'opencode', label: 'OpenCode Go（月付）', cors: false, hint: '获取 Key: opencode.ai → Zen → Go API Key（需点击下方「切换到本地代理」）' },
  { value: 'ollama', label: '本地模型 (Ollama / LM Studio 等)', cors: true, hint: '本地 OpenAI-compatible /v1 接口；Ollama 常用 http://localhost:11434/v1，LM Studio 常用 http://localhost:1234/v1；通常无需 API Key。' },
  { value: 'custom', label: '自定义', cors: true, hint: '填写任何兼容 OpenAI 格式的 API' },
]
