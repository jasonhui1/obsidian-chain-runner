import { describe, it, expect } from 'vitest'
import { buildDirectLabel, cardProposal, DIRECT_LINK, directLabelRunId, rerunScene, relabel, selectedRunId } from '@/ui/runLabel'
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
  const fronts: Record<string, unknown> = { 'Chain Runner/2026-09-15-ubqPU2/Optimist.md': { run: RUN, output: 'Optimist' } }
  const noteRun = (linkpath: string) => fronts[linkpath]

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

describe('cardProposal', () => {
  const fronts: Record<string, unknown> = {
    'Chain Runner/2026-09-15-ubqPU2/gameplay.md': { run: RUN, chain: 'creative-director', output: 'gameplay' },
    'Notes/plain.md': { run: 'every morning' },
  }
  const frontmatter = (linkpath: string) => fronts[linkpath]

  it('names the run and the proposal a card’s output note records', () => {
    const card: SceneShape = { id: 'card', type: 'embeddable', link: '[[Chain Runner/2026-09-15-ubqPU2/gameplay.md]]' }
    expect(cardProposal(card, frontmatter)).toEqual({ runId: RUN, proposal: 'gameplay' })
  })

  it('is undefined for anything that is not a card showing an output note', () => {
    expect(cardProposal({ id: 't', type: 'text', text: 'gameplay' }, frontmatter)).toBeUndefined()
    expect(cardProposal({ id: 'c', type: 'embeddable', link: '[[Notes/plain.md]]' }, frontmatter)).toBeUndefined()
    expect(cardProposal({ id: 'c', type: 'embeddable', link: '[[missing]]' }, frontmatter)).toBeUndefined()
  })
})

describe('rerunScene', () => {
  const OLD = '2026-09-15-old'
  const OLDER = '2026-09-14-older'
  const NEW = '2026-09-16-new'
  const fronts: Record<string, unknown> = {
    'runs/old/Verdict.md': { run: OLD, output: 'Verdict' },
    'runs/old/World.md': { run: OLD, output: 'World' },
    'runs/older/World.md': { run: OLDER, output: 'World' },
    'runs/other/World.md': { run: 'another', output: 'World' },
  }
  const noteRun = (linkpath: string) => fronts[linkpath]
  type Shape = SceneShape & { frameId?: string | null; name?: string | null }
  const card = (id: string, path: string, frameId = 'frame'): Shape => ({ id, type: 'embeddable', link: `[[${path}]]`, frameId })
  const label = (runId: string): Shape => ({ id: `label-${runId}`, type: 'text', frameId: 'frame', ...buildDirectLabel(frame, runId) })
  const runFrame = (name: string, id = 'frame'): Shape => ({ id, type: 'frame', name })

  it('finds the cards of any run the hold was under, by the output each shows', () => {
    const scene = [card('a', 'runs/old/Verdict.md'), card('b', 'runs/older/World.md'), card('c', 'runs/other/World.md')]
    const found = rerunScene(scene, [OLD, OLDER], NEW, noteRun)
    expect(found?.cards.map(one => [one.element.id, one.output])).toEqual([
      ['a', 'Verdict'],
      ['b', 'World'],
    ])
  })

  it('finds the Direct labels of those runs', () => {
    const found = rerunScene([label(OLD), label('another')], [OLD], NEW, noteRun)
    expect(found?.labels.map(one => one.id)).toEqual([`label-${OLD}`])
  })

  it('renames the frame those sit in to the new run, and no other frame', () => {
    const scene = [runFrame(`creative-director · ${OLD}`), runFrame(`creative-director · ${OLD}`, 'elsewhere'), card('a', 'runs/old/Verdict.md')]
    expect(rerunScene(scene, [OLD], NEW, noteRun)?.frames).toEqual([{ element: scene[0], name: `creative-director · ${NEW}` }])
  })

  it('leaves a frame the reader renamed as it is', () => {
    const scene = [runFrame('my best run'), card('a', 'runs/old/Verdict.md')]
    expect(rerunScene(scene, [OLD], NEW, noteRun)?.frames).toEqual([])
  })

  it('is undefined for a drawing that shows none of the runs', () => {
    expect(rerunScene([card('c', 'runs/other/World.md'), label('another')], [OLD], NEW, noteRun)).toBeUndefined()
  })
})

describe('relabel', () => {
  it('names the new run, keeping any other plugin’s stamp', () => {
    const relabelled = relabel({ other: 1, chainRunnerRun: { runId: 'old' } }, 'new')
    expect(relabelled).toEqual({ other: 1, chainRunnerRun: { runId: 'new' } })
    expect(directLabelRunId({ customData: relabelled })).toBe('new')
  })
})
