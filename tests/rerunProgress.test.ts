import { describe, it, expect } from 'vitest'
import { RerunProgressTracker } from '@/run/rerunProgress'
import type { LayoutPanel, PanelState, RunEvent } from '@/engine/types'

/** A rerun's progress, heard from the engine's own frames rather than worked out here (ADR-0001). */

const panel = (name: string, state: PanelState, emphasis?: 'join'): LayoutPanel => ({
  name,
  node: `${name}-node`,
  text: '',
  lines: 1,
  state,
  ...(emphasis ? { emphasis } : {}),
})

const frame = (...panels: LayoutPanel[]): RunEvent => ({ type: 'layout', model: { kind: 'columns', panels } })
const start = (node: string, agentName = 'agent'): RunEvent => ({ type: 'agent_start', agentName, nodeId: node, step: 0 })

describe('RerunProgressTracker', () => {
  it('says nothing until the first frame names the cards still waiting', () => {
    const tracker = new RerunProgressTracker()
    expect(tracker.hear({ type: 'run_start', runId: 'r' })).toBeUndefined()
    expect(tracker.hear(start('verdict-node'))).toBeUndefined()
  })

  it('writes again the cards the first frame has waiting, and no card it has filled', () => {
    const tracker = new RerunProgressTracker()
    const heard = tracker.hear(frame(panel('gameplay', 'filled'), panel('world', 'pending'), panel('verdict', 'pending', 'join')))
    expect(heard).toEqual({ verdict: true, proposals: ['world'] })
  })

  it('names the step by its card, or else by its agent, and says whether it writes the verdict', () => {
    const tracker = new RerunProgressTracker()
    tracker.hear(frame(panel('world', 'pending'), panel('verdict', 'pending', 'join')))
    expect(tracker.hear(start('scratch', 'critic'))?.step).toEqual({ name: 'critic', writesVerdict: false })
    expect(tracker.hear(start('verdict-node', 'director'))?.step).toEqual({ name: 'verdict', writesVerdict: true })
  })

  it('keeps a card written again once it fills, since what it holds lands only with the run', () => {
    const tracker = new RerunProgressTracker()
    tracker.hear(frame(panel('world', 'pending'), panel('verdict', 'pending', 'join')))
    expect(tracker.hear(frame(panel('world', 'filled'), panel('verdict', 'pending', 'join')))).toEqual({ verdict: true, proposals: ['world'] })
  })

  it('lets go of a card the engine skips', () => {
    const tracker = new RerunProgressTracker()
    tracker.hear(frame(panel('world', 'pending'), panel('verdict', 'pending', 'join')))
    expect(tracker.hear(frame(panel('world', 'skipped'), panel('verdict', 'pending', 'join')))).toEqual({ verdict: true, proposals: [] })
  })
})
