export const AGENT_DOCK_MIN_WIDTH = 320
export const AGENT_DOCK_MAX_WIDTH = 720
export const AGENT_DOCK_DEFAULT_WIDTH = 380
export const AGENT_DOCK_MIN_WORKSPACE_WIDTH = 360

export function clampAgentDockWidth(width: number, viewportWidth: number): number {
  const viewportMaximum = Math.max(AGENT_DOCK_MIN_WIDTH, viewportWidth - AGENT_DOCK_MIN_WORKSPACE_WIDTH)
  const maximum = Math.min(AGENT_DOCK_MAX_WIDTH, viewportMaximum)
  return Math.round(Math.min(maximum, Math.max(AGENT_DOCK_MIN_WIDTH, width)))
}
