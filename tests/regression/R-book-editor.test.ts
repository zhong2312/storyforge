import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds'
import { modelSceneForCategory } from '../../src/lib/ai/model-scenes'
import { projectRagSourceTables } from '../../src/lib/retrieval/retrieval'
import { bookEditScopeTables } from '../../src/components/editor/BookEditorPanel'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('R-BOOK-EDITOR · 全书编辑工具', () => {
  it('各编辑范围只包含 PROJECT_TABLES 派生的 RAG 数据表', () => {
    const registered = new Set(projectRagSourceTables())
    for (const scope of ['manuscript', 'structure', 'characters', 'world'] as const) {
      const tables = bookEditScopeTables(scope) ?? []
      expect(tables.length, scope).toBeGreaterThan(0)
      expect(tables.every(table => registered.has(table)), scope).toBe(true)
    }
    expect(bookEditScopeTables('all')).toBeUndefined()
  })

  it('全书编辑使用独立提示词模板并绑定润色模型场景', () => {
    const template = SYSTEM_PROMPT_SEEDS.find(seed => seed.moduleKey === 'book.edit')
    expect(template?.isActive).toBe(true)
    expect(template?.systemPrompt).toContain('matchMode=exact')
    expect(template?.systemPrompt).toContain('nextOffset=null')
    expect(template?.systemPrompt).toContain('storyforge.change.propose')
    expect(modelSceneForCategory('book.edit')).toBe('polish')
  })

  it('工作区提供全书编辑入口并通过 Agent 发起只读或审批修改任务', () => {
    const sidebar = source('src/components/layout/sidebar-tree.ts')
    const workspace = source('src/pages/WorkspacePage.tsx')
    const panel = source('src/components/editor/BookEditorPanel.tsx')

    expect(sidebar).toContain("leaf('book-editor',      '全书编辑'")
    expect(workspace).toContain("case 'book-editor':")
    expect(workspace).toContain('<BookEditorPanel project={project}')
    expect(panel).toContain("promptModuleKey: 'book.edit'")
    expect(panel).toContain("type: isEdit ? 'book.edit.apply' : 'book.edit.scan'")
    expect(panel).toContain('nextOffset=null')
    expect(panel).toContain('本次只读，禁止提出或提交修改')
  })

  it('精确检索仍通过注册表上下文源，不允许工具直接散读数据库', () => {
    const tools = source('src/lib/agent/tools/internal/storyforge-tools.ts')
    const contexts = source('src/lib/registry/context-sources.ts')

    expect(tools).toContain("sourceKeys: ['ragSearch']")
    expect(tools).toContain("retrievalMatchMode: input.matchMode ?? 'semantic'")
    expect(contexts).toContain("if (input.retrievalMatchMode === 'exact')")
    expect(tools).not.toContain('db.')
  })
})
