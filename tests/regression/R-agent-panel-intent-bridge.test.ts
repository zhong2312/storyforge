import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('R-AGENT-INTENT · 原有功能进入右侧 Agent', () => {
  it('灵感和角色入口不再维护局部流式输出', () => {
    const inspiration = source('src/components/project/InspirationPanel.tsx')
    const character = source('src/components/character/CharacterPanel.tsx')
    const supplement = source('src/components/character/CharacterSupplementAction.tsx')

    for (const content of [inspiration, character, supplement]) {
      expect(content).toContain('dispatchAgentIntent')
      expect(content).not.toContain('AIStreamOutput')
      expect(content).not.toContain('useAIStream')
    }
    expect(supplement).toContain('mode=merge-diffs')
    expect(supplement).toContain('recordId=${character.id}')
  })

  it('大纲和章节主操作携带实体作用域进入 Agent', () => {
    const outline = source('src/components/outline/OutlinePanel.tsx')
    const chapter = source('src/components/editor/ChapterEditor.tsx')

    expect(outline).toContain('const prepareGeneration = (request: OutlineGenerationRequest) => {')
    expect(outline).toContain('dispatchAgentIntent({')
    expect(outline).toContain("type: 'outline.chapter.batch'")
    expect(chapter).toContain('const dispatchChapterIntent = (')
    expect(chapter).toContain("chapterId: currentChapter.id")
    expect(chapter).toContain("'chapter.content'")
    expect(chapter).toContain("'chapter.continue'")
    expect(chapter).not.toContain('AIStreamOutput')
  })

  it('Workspace 只接收当前项目意图并交给 AgentDock 自动消费', () => {
    const workspace = source('src/pages/WorkspacePage.tsx')
    const dock = source('src/components/agent/AgentDock.tsx')

    expect(workspace).toContain('isIntentForDexieProject(intent, currentId)')
    expect(workspace).toContain('setRightPanel(\'agent\')')
    expect(workspace).toContain('intent={pendingAgentIntent}')
    expect(dock).toContain('buildAgentIntentPrompt(intent)')
    expect(dock).toContain('agentScopeFromIntent(intent)')
  })
})
