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

  it('Agent Dock 提供功能分组会话历史与逐阶段输出', () => {
    const dock = source('src/components/agent/AgentDock.tsx')
    const conversations = source('src/lib/agent/conversations/agent-conversation-store.ts')

    expect(dock).toContain('<ConversationHistory')
    expect(dock).toContain('<PhaseTimeline')
    expect(dock).toContain('defaultConversationGroupId(scope.module || activeModule)')
    expect(conversations).toContain("{ id: 'characters', label: '角色'")
    expect(conversations).toContain("{ id: 'chapters', label: '正文'")
    expect(conversations).toContain('saveAgentConversationState')
  })

  it('章节正文必须完成提案，并支持预览、调整和最终采纳', () => {
    const chapter = source('src/components/editor/ChapterEditor.tsx')
    const dock = source('src/components/agent/AgentDock.tsx')
    const runtime = source('src/lib/agent/runtime/ai-sdk/ai-sdk-agent-runtime-adapter.ts')

    expect(chapter).toContain("kind: 'change-proposal'")
    expect(chapter).toContain("target: 'chapters'")
    expect(chapter).toContain("requiredFields: ['content']")
    expect(runtime).toContain('assertCompletionProposalInput')
    expect(runtime).toContain('requiredCompletionTool: input.completionRequirement ? PROPOSE_TOOL')
    expect(dock).toContain('正文已生成，是否采纳？')
    expect(dock).toContain('希望如何调整？')
    expect(dock).toContain('采纳最终版本')
    expect(dock).toContain("decision: 'edited'")
  })

  it('角色设计和补全操作必须完成角色变更提案', () => {
    const design = source('src/components/character/CharacterPanel.tsx')
    const supplement = source('src/components/character/CharacterSupplementAction.tsx')

    expect(design).toContain("target: 'characters'")
    expect(design).toContain("mode: 'add'")
    expect(design).toContain("requiredFields: ['name', 'roleWeight', 'moralAxis', 'orderAxis']")
    expect(supplement).toContain("mode: 'merge-diffs'")
    expect(supplement).toContain('recordId: character.id')
    expect(supplement).toContain('requiredFields: dims')
  })
})
