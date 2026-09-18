import { describe, it, expect, beforeEach } from 'vitest'
import { DirectRun, NO_RUN_TO_DIRECT } from '@/ui/directRun'
import { HoldNotes } from '@/ui/holdNotes'
import type { EngineClient } from '@/engine/client'
import { EngineOfflineError } from '@/engine/transport'
import type { AgentOutput, HoldRecord, LayoutModel, RunMeta } from '@/engine/types'
import type { RunResult } from '@/run/session'
import { MemoryNoteStore } from './memoryNoteStore'

/**
 * The order "Direct this run" happens in: what it refuses to run on, what it
 * fetches, and what it hands the hold-note writer. The note's own content is
 * `holdNote.test.ts`; the vault write is `holdNotes.test.ts`.
 */

const result = (over: Partial<RunResult> = {}): RunResult => ({
  chainName: 'creative-director',
  moment: '',
  seed: { note: 'seed.md', from: 'note' },
  status: 'done',
  runId: '2026-09-15-Ab3dE1',
  layout: { kind: 'columns', panels: [] },
  ...over,
})

let current: RunResult | undefined
let notices: string[]
let store: MemoryNoteStore
let notes: Record<string, string>
let layout: LayoutModel
let agentOutputs: AgentOutput[]
let online: boolean
let requestedRunIds: string[]
let opened: string[]
let openedRuns: string[]
let holds: HoldRecord[]
let askedWaiting: string[]

const meta = (runId: string): RunMeta => ({
  runId,
  chainName: 'creative-director',
  seedPrompt: '',
  startedAt: '',
  status: holds.some(hold => !hold.resolvedAt) ? 'waiting' : 'complete',
  agentOutputs,
  holds,
})

const pick = (over: Partial<HoldRecord> = {}): HoldRecord => ({
  nodeId: 'pick',
  input: '',
  candidates: [{ heading: 'Candidate 1', body: 'A trial.' }],
  reachedAt: 'now',
  ...over,
})

function makeDirectRun(): DirectRun {
  const engine = {
    getLayout: (runId: string) => {
      requestedRunIds.push(runId)
      return Promise.resolve(layout)
    },
    getRun: (runId: string) => {
      requestedRunIds.push(runId)
      return Promise.resolve(meta(runId))
    },
    waitingRun: (runId: string) => {
      if (!online) return Promise.reject(new EngineOfflineError('http://engine', new Error('down')))
      askedWaiting.push(runId)
      return Promise.resolve(holds.some(hold => !hold.resolvedAt) ? meta(runId) : undefined)
    },
  } as unknown as EngineClient

  return new DirectRun({
    engine,
    withEngine: async action => (online ? action() : undefined),
    notify: message => void notices.push(message),
    holdNotes: new HoldNotes({ store, notify: message => void notices.push(message) }),
    currentRun: () => current,
    open: (path, runId) => {
      opened.push(path)
      openedRuns.push(runId)
      return Promise.resolve()
    },
  })
}

beforeEach(() => {
  current = result()
  notices = []
  store = new MemoryNoteStore()
  notes = store.notes
  layout = {
    kind: 'columns',
    panels: [
      { name: 'character-director', node: 'character', text: 'Shrine-maiden silhouette.', lines: 1, state: 'filled' },
      { name: 'creative-director', node: 'decider', text: 'Halo = stance-switching combat.', lines: 1, state: 'filled', emphasis: 'join' },
    ],
  }
  agentOutputs = [
    { nodeId: 'character', agentName: 'character-director', output: 'Shrine-maiden silhouette.', status: 'success', timestamp: '', thought: 'Considered a crown first.' },
  ]
  online = true
  requestedRunIds = []
  opened = []
  openedRuns = []
  holds = []
  askedWaiting = []
})

describe('start', () => {
  it('says there is nothing to direct when no run is on screen', async () => {
    current = undefined
    await makeDirectRun().start()
    expect(notices).toEqual([NO_RUN_TO_DIRECT])
    expect(notes).toEqual({})
  })

  it('says there is nothing to direct while the run is still going', async () => {
    current = result({ status: 'running' })
    await makeDirectRun().start()
    expect(notices).toEqual([NO_RUN_TO_DIRECT])
  })

  it('says there is nothing to direct when the run never got an id', async () => {
    current = result({ runId: undefined })
    await makeDirectRun().start()
    expect(notices).toEqual([NO_RUN_TO_DIRECT])
  })

  it('fetches this run’s layout and meta from the engine, by its id', async () => {
    await makeDirectRun().start()
    expect(requestedRunIds).toEqual(['2026-09-15-Ab3dE1', '2026-09-15-Ab3dE1'])
  })

  it('writes a hold note carrying the verdict, the proposal and its thought', async () => {
    await makeDirectRun().start()
    const content = notes['Maestro/holds/2026-09-15-Ab3dE1.md']
    expect(content).toContain('Halo = stance-switching combat.')
    expect(content).toContain('Shrine-maiden silhouette.')
    expect(content).toContain('Considered a crown first.')
  })

  it('opens the hold note it wrote', async () => {
    await makeDirectRun().start()
    expect(opened).toEqual(['Maestro/holds/2026-09-15-Ab3dE1.md'])
  })

  it('writes nothing when the engine is offline', async () => {
    online = false
    await makeDirectRun().start()
    expect(notes).toEqual({})
    expect(opened).toEqual([])
  })
})

describe('direct', () => {
  it('directs a run by its id alone, with no run on screen, titled by the chain the engine recorded', async () => {
    current = undefined
    await makeDirectRun().direct('2026-09-15-ubqPU2')
    expect(notes['Maestro/holds/2026-09-15-ubqPU2.md']).toContain('# Hold: run 2026-09-15-ubqPU2 · creative-director')
    expect(opened).toEqual(['Maestro/holds/2026-09-15-ubqPU2.md'])
  })
})

describe('write', () => {
  it('writes the hold without opening it', async () => {
    const path = await makeDirectRun().write('2026-09-15-ubqPU2')
    expect(path).toBe('Maestro/holds/2026-09-15-ubqPU2.md')
    expect(notes['Maestro/holds/2026-09-15-ubqPU2.md']).toContain('# Hold: run 2026-09-15-ubqPU2')
    expect(opened).toEqual([])
  })
})

describe('a run waiting at a hold', () => {
  const PATH = 'Maestro/holds/2026-09-15-ubqPU2.md'

  it('writes the note from the open hold', async () => {
    holds = [pick({ prompt: 'Which one?' })]
    await makeDirectRun().write('2026-09-15-ubqPU2')
    expect(notes[PATH]).toContain('Stopped because: waiting at pick.')
    expect(notes[PATH]).toContain('*Which one?*')
    expect(notes[PATH]).toContain('- [ ] Candidate 1')
  })

  it('writes the note as the run reaches a hold, without opening it', async () => {
    holds = [pick()]
    await makeDirectRun().holdReached('2026-09-15-ubqPU2', 'pick')
    expect(notes[PATH]).toContain('## Waiting at pick')
    expect(opened).toEqual([])
    expect(notices).toEqual(['Run 2026-09-15-ubqPU2 is waiting at pick: its hold note is written'])
  })

  it('lands both holds of a wave, keeping a pick made on the first', async () => {
    holds = [pick()]
    const direct = makeDirectRun()
    await direct.holdReached('2026-09-15-ubqPU2', 'pick')
    notes[PATH] = notes[PATH]!.replace('- [ ] Candidate 1', '- [x] Candidate 1')
    holds = [pick(), pick({ nodeId: 'pick-2' })]
    await direct.holdReached('2026-09-15-ubqPU2', 'pick-2')
    expect(notes[PATH]).toContain('Stopped because: waiting at pick, pick-2.')
    expect(notes[PATH]).toContain('## Waiting at pick\n')
    expect(notes[PATH]).toContain('## Waiting at pick-2\n')
    expect(notes[PATH]).toContain('- [x] Candidate 1')
  })
})

describe('refresh', () => {
  it('brings a stale note up to date without opening it', async () => {
    await makeDirectRun().write('2026-09-15-ubqPU2')
    holds = [pick()]
    await makeDirectRun().refresh('2026-09-15-ubqPU2')
    expect(notes['Maestro/holds/2026-09-15-ubqPU2.md']).toContain('## Waiting at pick')
    expect(opened).toEqual([])
  })

  it('writes no note for a run that has none', async () => {
    holds = [pick()]
    await makeDirectRun().refresh('2026-09-15-ubqPU2')
    expect(notes).toEqual({})
    expect(askedWaiting).toEqual([])
  })
})

describe('openHold', () => {
  const PATH = 'Maestro/holds/2026-09-15-ubqPU2.md'

  it('opens a hold already written as it is, when the engine cannot be asked', async () => {
    notes[PATH] = '# Hold: run 2026-09-15-ubqPU2 · creative-director\n\n## Direction\nKEEP: character-director\n'
    online = false
    await makeDirectRun().openHold('2026-09-15-ubqPU2')
    expect(openedRuns).toEqual(['2026-09-15-ubqPU2'])
    expect(requestedRunIds).toEqual([])
    expect(notes[PATH]).toContain('KEEP: character-director')
    expect(notices).toEqual([])
  })

  it('leaves a hold that is up to date as it is, fetching nothing more', async () => {
    await makeDirectRun().write('2026-09-15-ubqPU2')
    requestedRunIds = []
    await makeDirectRun().openHold('2026-09-15-ubqPU2')
    expect(askedWaiting).toEqual(['2026-09-15-ubqPU2'])
    expect(requestedRunIds).toEqual([])
  })

  it('finds the hold a stale note does not show among the waiting runs, and shows it', async () => {
    await makeDirectRun().write('2026-09-15-ubqPU2')
    notes[PATH] = notes[PATH]!.replace('KEEP:\n', 'KEEP: character-director\n')
    holds = [pick()]
    notices = []
    await makeDirectRun().openHold('2026-09-15-ubqPU2')
    expect(notes[PATH]).toContain('Stopped because: waiting at pick.')
    expect(notes[PATH]).toContain('- [ ] Candidate 1')
    expect(notes[PATH]).toContain('KEEP: character-director')
    expect(openedRuns).toEqual(['2026-09-15-ubqPU2'])
    expect(notices).toEqual([])
  })

  it('takes a hold that was answered off a note that still shows it', async () => {
    holds = [pick()]
    await makeDirectRun().write('2026-09-15-ubqPU2')
    holds = [pick({ resolvedAt: 'later', chosen: 'Candidate 1' })]
    await makeDirectRun().openHold('2026-09-15-ubqPU2')
    expect(notes[PATH]).toContain('Stopped because: chain ended at its declared outputs.')
    expect(notes[PATH]).not.toContain('Candidate 1')
  })

  it('opens the hold a rerun moved on to, rather than writing the old run a fresh one', async () => {
    const moved = 'Maestro/holds/2026-09-15-WKRDJJ.md'
    notes[moved] = [
      '# Hold: run 2026-09-15-WKRDJJ · creative-director',
      '## Previous verdict',
      '<details>\n<summary>run 2026-09-15-ubqPU2</summary>\n\nOld.\n\n</details>',
      '## Proposals',
      '## Direction',
    ].join('\n\n')
    await makeDirectRun().openHold('2026-09-15-ubqPU2')
    expect(openedRuns).toEqual(['2026-09-15-WKRDJJ'])
    expect(Object.keys(notes)).toEqual([moved])
  })

  it('writes the hold first when there is none, then opens it', async () => {
    await makeDirectRun().openHold('2026-09-15-ubqPU2')
    expect(notes[PATH]).toContain('# Hold: run 2026-09-15-ubqPU2')
    expect(openedRuns).toEqual(['2026-09-15-ubqPU2'])
  })
})
