# StoryForge / 故事熔炉 — 开发进度文档

> **最后更新**: 2026-05-09 21:57 | **当前阶段**: Phase 2 ✅ + Design System v2 ✅ + AI 多平台接入 🔧 进行中

---

## 📌 快速上手（给下次接手的 AI / 开发者）

### 项目是什么？
**StoryForge（故事熔炉）** 是一款纯前端、开源的 AI 小说创作工坊。核心流程：
> 构建世界观 → AI 生成大纲 → AI 写章节正文 → 导出完整小说

### 技术栈
- **React 19** + **TypeScript** + **Vite 6**
- **Tailwind CSS 3** — 3 套场景主题（work/forge/paper，CSS 变量驱动）
- **Zustand** — 状态管理
- **Dexie.js** — IndexedDB 本地数据库（9 张表）
- **lucide-react** — 图标
- **react-router-dom 7** — 路由
- **Google Fonts** — Inter + Source Serif 4 + JetBrains Mono

### 启动开发
```bash
cd my-website/storyforge
# 如果用 nvm：
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
npm run dev    # http://localhost:5175/storyforge/
```

### 项目在主仓库中的位置
```
my-website/
├── yuntype/           # 云中书 — AI 排版工具
├── infiniteskill/     # InfiniteSkill — 技能编译器
├── storyforge/        # 故事熔炉 — AI 小说创作工坊 ← 当前项目
└── ...
```

### 设计文档
所有设计文档在 `storyforge/docs/` 下：
| 文档 | 内容 |
|------|------|
| `01-PRODUCT-OVERVIEW.md` | 产品定义、用户画像、竞品分析 |
| `02-FEATURE-SPEC.md` | 功能规格 |
| `03-UI-DESIGN.md` | UI 设计规范 |
| `04-TECH-ARCHITECTURE.md` | 技术架构（**最重要，必读**） |
| `05-WORLD-BUILDING-ENGINE.md` | 世界构建引擎 10 维度详细设计 |
| `06-AI-PROMPTS-SYSTEM.md` | AI 提示词系统设计 |
| `07-DEVELOPMENT-PLAN.md` | 开发计划（Phase 1-7 完整任务清单） |
| `08-DATA-SCHEMA.md` | 数据模型详细设计 |

---

## ✅ Phase 1 — 脚手架 + 基础框架（已完成）

**完成日期**: 2026-04-13

### 已完成内容

#### 1.1 项目配置文件
| 文件 | 说明 |
|------|------|
| `package.json` | React 19 + Vite 6 + Zustand 5 + Dexie 4 + lucide-react |
| `vite.config.ts` | base: `/storyforge/`，端口 5175 |
| `tsconfig.json` | strict mode，ES2020 target |
| `tailwind.config.ts` | 自定义颜色映射到 CSS 变量（bg-base, text-primary, accent 等） |
| `postcss.config.js` | tailwindcss + autoprefixer |
| `index.html` | 🔥 favicon，中文 lang |
| `.gitignore` | node_modules, dist |

#### 1.2 CSS 主题系统 — `src/index.css`
5 套完整主题，通过 `data-theme` 属性切换：

| 主题 | data-theme | 风格 |
|------|-----------|------|
| 🌑 深夜书房 | `midnight`（默认） | 纯黑底 + 靛蓝强调 |
| 🌃 暗夜蓝 | `ocean` | 深蓝灰底 + 青蓝强调 |
| 🌫️ 墨灰 | `graphite` | 中性灰底 + 暖橙强调 |
| ☁️ 烟白 | `mist` | 浅灰底 + 靛蓝强调 |
| 📜 暖纸 | `parchment` | 米色纸张底 + 棕色强调 |

#### 1.3 入口与路由
| 文件 | 说明 |
|------|------|
| `src/main.tsx` | ReactDOM.createRoot + BrowserRouter (basename: `/storyforge`) + 主题恢复 |
| `src/App.tsx` | Routes: `/` → HomePage, `/workspace/:projectId` → WorkspacePage |

#### 1.4 TypeScript 类型定义 — `src/lib/types/`
| 文件 | 导出类型 |
|------|---------|
| `project.ts` | `NovelGenre`（8 种类型）, `Project`, `CreateProjectInput` |
| `ai.ts` | `AIProvider`（6 种）, `AIConfig`, `ChatMessage`, `AIError`, `PROVIDER_PRESETS`（5 家预设） |
| `worldview.ts` | `Worldview`（7 字段）, `StoryCore`（4 字段）, `PowerSystem`（4 字段） |
| `character.ts` | `CharacterRole`（4 种）, `Character`（11 字段）, `Faction`（8 字段） |
| `outline.ts` | `OutlineNodeType`（3 级）, `OutlineNode`, `ChapterStatus`（5 种）, `Chapter` |
| `foreshadow.ts` | `ForeshadowType`（10 种）, `ForeshadowStatus`（4 种）, `Foreshadow` |
| `index.ts` | 统一导出所有类型 |

#### 1.5 数据库 — `src/lib/db/schema.ts`
基于 Dexie.js 的 IndexedDB 数据库，9 张表。

#### 1.6 状态管理 — `src/stores/`
| 文件 | Store | 功能 |
|------|-------|------|
| `project.ts` | `useProjectStore` | projects 列表, CRUD, 级联删除 |
| `ai-config.ts` | `useAIConfigStore` | AI 配置 localStorage 持久化, 提供商切换预设, 连接测试 |

#### 1.7 AI 客户端 — `src/lib/ai/client.ts`
| 函数 | 说明 |
|------|------|
| `streamChat()` | AsyncGenerator 流式聊天，SSE 解析，支持 AbortSignal 中断 |
| `chat()` | 非流式聊天（简单调用） |

#### 1.8 页面与组件
| 文件 | 说明 |
|------|------|
| `src/pages/HomePage.tsx` | 项目列表页 + 创建弹窗 |
| `src/pages/WorkspacePage.tsx` | 工作台页：模块路由分发 |
| `src/components/layout/Sidebar.tsx` | 10 模块导航 |
| `src/components/project/ProjectInfoPanel.tsx` | 项目基本信息编辑面板 |
| `src/components/settings/AIConfigPanel.tsx` | AI 配置面板 + 主题切换 |

---

## ✅ Phase 2 — AI 写作核心（已完成）

**完成日期**: 2026-04-13

### 已完成内容

#### 2.1 通用基础 — Hooks
| 文件 | 说明 |
|------|------|
| `src/hooks/useAIStream.ts` | 流式 AI 输出 Hook：`start(messages)` / `stop()` / `reset()`，返回 `{output, isStreaming, error}`。封装 streamChat + AbortController，**所有 AI 模块复用** |
| `src/hooks/useAutoSave.ts` | 自动保存 Hook：debounce 写入 IndexedDB，跳过首次渲染 |

#### 2.2 通用基础 — 共享组件
| 文件 | 说明 |
|------|------|
| `src/components/shared/AIStreamOutput.tsx` | AI 流式输出展示组件：打字机效果 + 闪烁光标 + 字数统计 + 操作栏（停止/采纳/重试） |

#### 2.3 AI 提示词系统 — `src/lib/ai/prompts/`
| 文件 | 导出函数 | 人设 |
|------|---------|------|
| `worldview.ts` | `buildWorldviewPrompt()` | 资深奇幻/科幻世界设计师 |
| `character.ts` | `buildCharacterPrompt()`, `buildCharacterDimensionPrompt()` | 角色设计大师 |
| `outline.ts` | `buildVolumeOutlinePrompt()`, `buildChapterOutlinePrompt()` | 经验丰富的大纲师 |
| `chapter.ts` | `buildChapterContentPrompt()`, `buildContinuePrompt()`, `buildPolishPrompt()`, `buildExpandPrompt()`, `buildDeAIPrompt()` | 网文"老贼"写手 + 润色/扩写/去AI味专家 |

#### 2.4 上下文构建器 — `src/lib/ai/context-builder.ts`
| 函数 | 说明 |
|------|------|
| `buildWorldContext()` | 组装世界观 + 故事核心 + 力量体系摘要 |
| `buildCharacterContext()` | 组装角色列表摘要 |
| `buildExistingWorldview()` | 组装世界观已有维度内容（供 AI 保持一致） |

#### 2.5 状态管理 Stores
| 文件 | Store | 功能 |
|------|-------|------|
| `src/stores/worldview.ts` | `useWorldviewStore` | 世界观 + 故事核心 + 力量体系的加载/保存（自动创建或更新） |
| `src/stores/character.ts` | `useCharacterStore` | 角色 + 势力 CRUD |
| `src/stores/outline.ts` | `useOutlineStore` | 大纲节点 CRUD + `addNodes()` 批量添加 + 级联删除子节点 |
| `src/stores/chapter.ts` | `useChapterStore` | 章节 CRUD + `selectChapter()` 当前章节选择 |
| `src/stores/foreshadow.ts` | `useForeshadowStore` | 伏笔 CRUD + `updateStatus()` 状态流转 |

#### 2.6 功能面板组件
| 文件 | 说明 |
|------|------|
| `src/components/worldview/WorldviewPanel.tsx` | 世界观 7 维度 Tab 编辑 + AI 一键生成 + 采纳填充 |
| `src/components/worldview/StoryCorePanel.tsx` | 故事核心 4 字段表单（主题/冲突/模式/故事线），onBlur 自动保存 |
| `src/components/worldview/PowerSystemPanel.tsx` | 力量体系编辑（名称/描述/等级/规则），onBlur 自动保存 |
| `src/components/character/CharacterPanel.tsx` | 角色列表 + 详情编辑器（7 维度展开/折叠）+ AI 设计角色 |
| `src/components/faction/FactionPanel.tsx` | 势力列表 + 6 字段编辑 |
| `src/components/outline/OutlinePanel.tsx` | 大纲树视图（卷→章）+ AI 生成卷级大纲 + AI 展开为章节 + 章节写作入口 |
| `src/components/editor/ChapterEditor.tsx` | **核心写作编辑器**：章节列表/选择 + AI 5 件套工具栏（生成正文/续写/扩写/润色/去AI味）+ 自定义指令 + 上下文查看器 + 自动保存 + 作者笔记 |
| `src/components/foreshadow/ForeshadowPanel.tsx` | 伏笔管理：按状态筛选 + 10 种类型 + 状态推进（计划→埋设→呼应→回收） |

#### 2.7 WorkspacePage 集成
`src/pages/WorkspacePage.tsx` 已更新：
- 进入工作台时**并行加载**所有模块数据（worldview, character, outline, chapter, foreshadow）
- 所有 10 个侧边栏模块均已接入对应面板（无 placeholder）
- 大纲面板可直接跳转到写作编辑器（`onOpenChapter`）

### Phase 2 当前文件结构
```
storyforge/src/
├── hooks/
│   ├── useAIStream.ts              # 流式 AI Hook
│   └── useAutoSave.ts              # 自动保存 Hook
├── stores/
│   ├── project.ts                  # Phase 1
│   ├── ai-config.ts                # Phase 1
│   ├── worldview.ts                # ← NEW
│   ├── character.ts                # ← NEW
│   ├── outline.ts                  # ← NEW
│   ├── chapter.ts                  # ← NEW
│   └── foreshadow.ts              # ← NEW
├── lib/
│   ├── ai/
│   │   ├── client.ts              # Phase 1
│   │   ├── context-builder.ts     # ← NEW 上下文组装
│   │   └── prompts/
│   │       ├── worldview.ts       # ← NEW
│   │       ├── character.ts       # ← NEW
│   │       ├── outline.ts         # ← NEW
│   │       └── chapter.ts         # ← NEW
│   ├── db/schema.ts               # Phase 1
│   └── types/                     # Phase 1
├── components/
│   ├── shared/
│   │   └── AIStreamOutput.tsx     # ← NEW 流式输出组件
│   ├── worldview/
│   │   ├── WorldviewPanel.tsx     # ← NEW
│   │   ├── StoryCorePanel.tsx     # ← NEW
│   │   └── PowerSystemPanel.tsx   # ← NEW
│   ├── character/
│   │   └── CharacterPanel.tsx     # ← NEW
│   ├── faction/
│   │   └── FactionPanel.tsx       # ← NEW
│   ├── outline/
│   │   └── OutlinePanel.tsx       # ← NEW
│   ├── editor/
│   │   └── ChapterEditor.tsx      # ← NEW
│   ├── foreshadow/
│   │   └── ForeshadowPanel.tsx    # ← NEW
│   ├── layout/Sidebar.tsx         # Phase 1
│   ├── project/ProjectInfoPanel.tsx  # Phase 1
│   └── settings/AIConfigPanel.tsx    # Phase 1
└── pages/
    ├── HomePage.tsx               # Phase 1
    └── WorkspacePage.tsx          # ← UPDATED（接入所有模块）
```

### Phase 2 验收状态
- [x] 能 AI 生成世界观各维度内容并保存
- [x] 角色/势力 CRUD 正常
- [x] 能 AI 生成卷级大纲 → 展开为章节
- [x] 能从大纲生成章节正文（流式）
- [x] 能续写/扩写/润色/去AI味正文
- [x] 能停止 AI 生成
- [x] 自动保存正常工作（useAutoSave Hook）
- [x] 伏笔 CRUD + 状态流转正常
- [x] 上下文查看器能显示发送的 prompt

---

## ✅ Design System v2 迁移（已完成）

**完成日期**: 2026-05-09

### 变更概述
将旧的 5 套主题（midnight/ocean/graphite/mist/parchment，靛蓝色调）替换为全新的 3 套场景主题（品牌色 🔥 火光橙 #D97757）。

### 3 套新主题
| 主题 | data-theme | 用途 |
|------|-----------|------|
| 🔨 工作 | `work` | 深色暖黑，日常生产，WorkspacePage 默认 |
| 🔥 熔炉 | `forge` | 暖棕火光，HomePage 仪式感 |
| 📄 纸张 | `paper` | 浅色米白，未来焦点模式写作用 |

### 修改的文件
| 文件 | 变更 |
|------|------|
| `index.html` | 添加 Google Fonts (Inter, Source Serif 4, JetBrains Mono) |
| `src/index.css` | 替换 5 套旧主题 → 3 套新主题 + 旧名兼容映射 |
| `tailwind.config.ts` | 新增 fontFamily, brand 颜色, accent.soft, border.subtle, boxShadow, fontSize 阶梯 |
| `src/pages/WorkspacePage.tsx` | 添加 `data-theme="work"` |
| `src/pages/HomePage.tsx` | 添加 forge 辉光渐变 + 衬线标题 |
| `src/components/shared/AIStreamOutput.tsx` | 添加左侧火光色条 + 柔和背景 |

### 设计系统文档
- `design-system/design-system.md` — 完整设计规范
- `design-system/tokens.css` — CSS 变量定义
- `design-system/tailwind.config.ts` — Tailwind 配置
- `design-system/MIGRATION.md` — 迁移指南
- `design-system/components-demo.html` — 组件预览
- `design-system/scenes-demo.html` — 三场景预览

---

## 🔧 AI 多平台接入（进行中）

**开始日期**: 2026-05-09 | **当前状态**: 日志系统 ✅ + DeepSeek ✅ + Poe 适配 ✅ (bug修复 05-09 21:55)

### 目标
纯前端工具，用户自配 API Key，浏览器直接调用 AI API（无需后端服务器）。

### CORS 兼容性测试结果

| # | 平台 | Base URL | CORS | 状态 |
|---|------|---------|------|------|
| 1 | DeepSeek | `https://api.deepseek.com/v1` | ✅ | ✅ 已完成 |
| 2 | Poe | `https://api.poe.com/bot` | ✅ | ✅ 已完成（需适配器） |
| 3 | 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | ✅ | 🔜 待测试 |
| 4 | 豆包 | `https://ark.cn-beijing.volces.com/api/v3` | ✅ | 🔜 待测试 |
| 5 | MiniMax | `https://api.minimax.chat/v1` | ✅ | 🔜 待测试 |
| 6 | 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | ✅ | 🔜 待测试 |
| 7 | 文心一言 | `https://qianfan.baidubce.com/v2` | ✅ | 🔜 待测试 |
| 8 | Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | ✅ | 🔜 待测试 |
| 9 | Kimi | `https://api.moonshot.cn/v1` | ❌ | 标注需代理 |
| 10 | OpenAI | `https://api.openai.com/v1` | ❌ | 标注需代理 |
| 11 | Claude | `https://api.anthropic.com/v1` | ❌ | 标注需代理 |

### 已完成的改动

#### 新增文件
| 文件 | 说明 |
|------|------|
| `src/lib/ai/logger.ts` | AI 连接日志系统（记录每次调用的 URL、状态码、耗时、错误详情） |

#### 修改文件
| 文件 | 变更 |
|------|------|
| `src/lib/types/ai.ts` | `AIProvider` 扩展为 13 种 + `PROVIDER_PRESETS` 包含所有平台预设 URL 和默认模型 |
| `src/stores/ai-config.ts` | `testConnection` 重写：详细错误解析 + 日志记录 + Poe 格式适配 |
| `src/lib/ai/client.ts` | `buildRequest()` 函数根据 provider 构造不同请求格式 + 流式日志记录 |
| `src/components/settings/AIConfigPanel.tsx` | 全部 11 个平台下拉选择 + 每个配置提示（去哪获取 Key）+ 日志面板 + 3 主题切换 |

### Bug 修复记录

#### 🐛 Poe 连接 404 问题（05-09 21:55 修复）

**现象**: 选择 Poe 提供商后测试连接，日志显示请求发到 `https://api.poe.com/v1//chat/completions`（404），未走 Poe 适配路径。

**根因**:
1. 用户手动将 Base URL 改为 `https://api.poe.com/v1/`（末尾带 `/`），拼接后产生双斜杠 `//`
2. `config.provider === 'poe'` 判断在某些场景下未生效（可能是 localStorage 中存储的旧值问题）

**修复**（commit `c5fcc0e`）:
- `ai-config.ts` + `client.ts` 两处同步修复：
  - 添加 URL 标准化：`baseUrl.replace(/\/+$/, '')` 去除尾部斜杠
  - 添加域名兜底检测：`baseUrl.includes('api.poe.com')` — 即使 provider 字段有问题，只要 URL 含 poe 域名就走 Poe 格式
  - Poe 请求格式：`{baseUrl}/{model}`（不含 `/chat/completions`）

**验证方法**: 在设置页重新切换到 Poe（会重置 Base URL 为 `https://api.poe.com/bot`），输入 Key 后测试连接。

### 当前测试状态

| 平台 | 状态 | 备注 |
|------|------|------|
| DeepSeek | ✅ 连通 | HTTP 402 = 余额不足（非代码问题） |
| Poe | 🔧 已修复待验证 | 需用户重新切换 provider 或手动改 Base URL 为 `https://api.poe.com/bot` |
| 通义千问 | 🔜 待测试 | — |
| 豆包 | 🔜 待测试 | — |
| MiniMax | 🔜 待测试 | — |
| 智谱 GLM | 🔜 待测试 | — |
| 文心一言 | 🔜 待测试 | — |
| Gemini | 🔜 待测试 | — |

### 下一步待做
1. **验证 Poe 修复** — 用户需在设置中重新选择 Poe 提供商（触发 switchProvider 重置 Base URL）
2. 逐个测试通义千问、豆包、MiniMax、智谱GLM、文心、Gemini 的实际连接
3. 如果某些平台 API 格式有细微差异，在 `buildRequest()` 中加适配
4. 考虑给 Kimi/OpenAI/Claude 添加 Vercel Serverless 代理（生产环境）

### 开发 Tips
- 选择 DeepSeek → 输入 key → 测试连接 → 如果显示 "Insufficient Balance" 说明连接成功但余额不足
- 点「日志」按钮可查看完整请求日志（URL、HTTP 状态码、耗时、错误信息）
- Poe 的 API 格式不同：endpoint 是 `baseUrl/{model}` 而非 `baseUrl/chat/completions`
- **⚠️ 如果切换 provider 后 Base URL 没变**，说明 localStorage 里有旧配置。可以在浏览器 DevTools → Application → Local Storage → 删除 `storyforge-ai-config` 重来

---

## 🔜 Phase 3 — 世界构建完善（下一步）

> **参考文档**: `docs/07-DEVELOPMENT-PLAN.md` Phase 3 章节

### 建议开发内容
- 补全地理环境面板（带层级地点列表）
- 历史年表面板（时间线视图）
- 社会结构面板
- 道具/法宝系统
- 规则约束面板（写作红线/一致性约束）
- 角色关系编辑

---

## 📋 后续 Phase 概览

详细任务清单见 `docs/07-DEVELOPMENT-PLAN.md`。

### Phase 4 — 伏笔增强 + 润色功能
- 伏笔与章节关联（埋设/呼应/回收标记到具体章节）
- AI 伏笔建议
- 选中文字 → 扩写/润色/去AI味
- 自定义 AI 指令

### Phase 5 — 导出 + 打磨
- JSON 导出/导入（完整项目备份）
- Markdown/TXT 导出
- 快捷键（Cmd+S / Cmd+Enter / Esc）
- Toast 通知、Loading 骨架屏、错误边界、空状态引导

### Phase 6 — 高级功能
- 自动定时备份（IndexedDB 快照）
- 版本历史面板
- File System Access API（本地文件夹自动保存）
- GitHub Gist 导出
- 角色关系图可视化（react-force-graph-2d）
- PWA 支持

### Phase 7 — 打磨增强
- TipTap 富文本编辑器替换 textarea
- 侧边栏折叠（图标模式）
- 属性面板（选中项详细属性）
- AI 概念地图/图像地图

---

## 🔧 关键设计决策记录

### 1. 为什么用 CSS 变量而不是 Tailwind 的 dark mode？
因为需要 5 套主题，不仅是 light/dark 两种。通过 `data-theme` 属性 + CSS 变量实现。

### 2. 为什么 ID 用自增数字而不是 UUID？
Dexie.js 的 `++id` 自增 ID 性能更好，且 IndexedDB 对数字索引的查询效率高于字符串。

### 3. 为什么 AI 配置存 localStorage 而不是 IndexedDB？
AI 配置是全局的（不跟项目走），数据量小，localStorage 读写同步更方便。

### 4. 为什么 streamChat 用 AsyncGenerator？
比 callback 模式更优雅，调用方可以用 `for await...of` 逐块处理，也方便与 AbortController 配合实现中断。

### 5. 为什么删除项目要做级联删除？
因为所有数据通过 `projectId` 关联，删项目必须清除所有关联数据。

### 6. 为什么先做 textarea 编辑器而不是 TipTap？
降低初期复杂度。Phase 1-4 用 textarea 够用，Phase 7 再升级为 TipTap 富文本编辑器。

### 7. 为什么 Store 设计合并了一些相关表？（Phase 2 新增）
- `useWorldviewStore` 合并了 worldview + storyCore + powerSystem（它们是 1:1 关系，同一个项目只有一条记录）
- `useCharacterStore` 合并了 character + faction（同属"角色与势力"模块，UI 上经常一起操作）
- 大纲和章节分开 Store 是因为它们的使用场景不同（大纲是树形结构管理，章节是写作编辑器）

### 8. 为什么 AI 提示词函数返回 ChatMessage[] 而不是字符串？（Phase 2 新增）
因为 `streamChat()` 接收的就是 `ChatMessage[]` 格式。System Prompt + User Prompt 组合成数组直接传入，不需要额外拼接。

---

## 📊 统计

| 指标 | Phase 1 | Phase 2 | 合计 |
|------|---------|---------|------|
| 源代码文件 | 18 个 | +18 个 | 36 个 |
| TypeScript 类型 | ~20+ | — | ~20+ |
| 数据库表 | 9 张 | — | 9 张 |
| Zustand Stores | 2 个 | +5 个 | 7 个 |
| AI 提示词函数 | — | 10 个 | 10 个 |
| 功能面板组件 | 3 个 | +8 个 | 11 个 |
| CSS 主题 | 5 套 | — | 5 套 |
| 侧边栏模块 | 10 个（2 实现） | +8 个 | 10 个（全部实现） |
