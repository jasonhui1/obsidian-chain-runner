import type { AgentOutput, LayoutPanel, RunEvent } from '@/engine/types'

/** What the engine answers about a run, built the way the hold module's tests and the directing panel's share. */

export const output = (nodeId: string, text: string): AgentOutput => ({ nodeId, agentName: nodeId, output: text, status: 'success', timestamp: '' })

/** A card as the run filled it; `join` marks the verdict. */
export const panel = (name: string, text: string, emphasis?: 'join'): LayoutPanel => ({
  name,
  node: name,
  text,
  lines: 1,
  state: 'filled',
  ...(emphasis ? { emphasis } : {}),
})

/** The frame a rerun sends: every panel filled but those named, still waiting. */
export const layoutFrame = (panels: LayoutPanel[], ...waiting: string[]): RunEvent => ({
  type: 'layout',
  model: { kind: 'columns', panels: panels.map(one => (waiting.includes(one.node) ? { ...one, state: 'pending' as const } : one)) },
})

export const started = (runId: string): RunEvent[] => [{ type: 'run_start', runId }]

export const answer = (agentName: string, text: string): RunEvent[] => [
  { type: 'agent_done', agentName, nodeId: agentName, step: 0, output: output(agentName, text) },
]
