import { describe, it, expect } from 'vitest'
import { buildDirectLabel, DIRECT_LINK, directLabelRunId, selectedRunId } from '@/ui/runLabel'
import type { SceneShape } from '@/ui/nodeScene'

/** The `✎ Direct` label on a run's frame, and which run a selection on the drawing names. */

const RUN = '2026-09-15-ubqPU2'
const frame = { x: 1000, y: 200, width: 1800, height: 600 }

describe('buildDirectLabel', () => {
  const label = buildDirectLabel(frame, RUN)

  it('sits inside the frame’s top-right corner, above the panels', () => {
    expect(label.x).toBeGreaterThan(frame.x + frame.width / 2)
    expect(label.x + label.width).toBeLessThanOrEqual(frame.x + frame.width)
    expect(label.y).toBeGreaterThanOrEqual(frame.y)
    // Panels start a frame padding in; the label stays above them.
    expect(label.y + label.height).toBeLessThanOrEqual(frame.y + 32)
  })

  it('carries our own link and the run it directs', () => {
    expect(label.link).toBe(DIRECT_LINK)
    expect(directLabelRunId(label)).toBe(RUN)
  })
})

describe('directLabelRunId', () => {
  it('is undefined for an element that is not a Direct label', () => {
    expect(directLabelRunId({})).toBeUndefined()
    expect(directLabelRunId({ customData: { chainRunner: { runId: RUN } } })).toBeUndefined()
    expect(directLabelRunId({ customData: { chainRunnerRun: { runId: 7 } } })).toBeUndefined()
  })
})

describe('selectedRunId', () => {
  const runs: Record<string, string> = { 'Chain Runner/2026-09-15-ubqPU2/Optimist.md': RUN }
  const noteRun = (linkpath: string) => runs[linkpath]

  const card = (link: string): SceneShape => ({ id: 'card', type: 'embeddable', link })

  it('reads the run off a selected Direct label', () => {
    const label = { id: 'label', type: 'text', ...buildDirectLabel(frame, RUN) }
    expect(selectedRunId([label], () => undefined)).toBe(RUN)
  })

  it('reads the run off a selected card’s note, so a run drawn before the label existed can still be directed', () => {
    expect(selectedRunId([card('[[Chain Runner/2026-09-15-ubqPU2/Optimist.md]]')], noteRun)).toBe(RUN)
  })

  it('is undefined when nothing selected belongs to a run', () => {
    expect(selectedRunId([], noteRun)).toBeUndefined()
    expect(selectedRunId([{ id: 't', type: 'text', text: 'an idea' }], noteRun)).toBeUndefined()
    expect(selectedRunId([card('[[some other note]]')], noteRun)).toBeUndefined()
    expect(selectedRunId([card('https://example.com')], noteRun)).toBeUndefined()
  })
})
