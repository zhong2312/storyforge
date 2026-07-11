import { describe, expect, it } from 'vitest'
import { AGENT_DOCK_MAX_WIDTH, AGENT_DOCK_MIN_WIDTH, clampAgentDockWidth } from '../../src/lib/agent/presentation/agent-dock-size'

describe('Agent dock width', () => {
  it('enforces explicit minimum and maximum widths', () => {
    expect(clampAgentDockWidth(100, 1600)).toBe(AGENT_DOCK_MIN_WIDTH)
    expect(clampAgentDockWidth(900, 1600)).toBe(AGENT_DOCK_MAX_WIDTH)
  })

  it('keeps at least 360px for the workspace on narrower desktop viewports', () => {
    expect(clampAgentDockWidth(720, 1024)).toBe(664)
  })
})
