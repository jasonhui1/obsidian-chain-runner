import { describe, it, expect, beforeEach } from 'vitest'
import { DirectRun, NO_RUN_TO_DIRECT } from '@/ui/directRun'
import { HoldNotes } from '@/ui/holdNotes'
import type { EngineClient } from '@/engine/client'
import type { AgentOutput, LayoutModel } from '@/engine/types'
import type { RunResult } from '@/run/session'
import type { App, TFile } from 'obsidian'
import { TFile as StubFile, TFolder } from './obsidian'

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
let notes: Record<string, string>
let folders: string[]
let layout: LayoutModel
let agentOutputs: AgentOutput[]
let online: boolean
let requestedRunIds: string[]
let opened: string[]
let openedRuns: string[]

function file(path: string): TFile {
  const stub = new StubFile()
  stub.path = path
  stub.name = path.slice(path.lastIndexOf('/') + 1)
  return stub as unknown as TFile
}

function makeDirectRun(): DirectRun {
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => {
        if (notes[path] !== undefined) return file(path)
        if (folders.includes(path)) {
          const folder = new TFolder()
          folder.path = path
          return folder
        }
        return null
      },
      cachedRead: (target: { path: string }) => Promise.resolve(notes[target.path] ?? ''),
      getMarkdownFiles: () => Object.keys(notes).map(file),
      create: (path: string, content: string) => {
        notes[path] = content
        return Promise.resolve(file(path))
      },
      modify: (target: { path: string }, content: string) => {
        notes[target.path] = content
        return Promise.resolve()
      },
      createFolder: (path: string) => {
        folders.push(path)
        return Promise.resolve(undefined)
      },
    },
  } as unknown as App

  const engine = {
    getLayout: (runId: string) => {
      requestedRunIds.push(runId)
      return Promise.resolve(layout)
    },
    getRun: (runId: string) => {
      requestedRunIds.push(runId)
      return Promise.resolve({ runId, chainName: 'creative-director', seedPrompt: '', startedAt: '', status: 'complete', agentOutputs })
    },
  } as unknown as EngineClient

  return new DirectRun({
    engine,
    withEngine: async action => (online ? action() : undefined),
    notify: message => void notices.push(message),
    holdNotes: new HoldNotes({ app, notify: message => void notices.push(message) }),
    currentRun: () => current,
    open: (note, runId) => {
      opened.push(note.path)
      openedRuns.push(runId)
      return Promise.resolve()
    },
  })
}

beforeEach(() => {
  current = result()
  notices = []
  notes = {}
  folders = []
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
    const note = await makeDirectRun().write('2026-09-15-ubqPU2')
    expect(note?.path).toBe('Maestro/holds/2026-09-15-ubqPU2.md')
    expect(notes['Maestro/holds/2026-09-15-ubqPU2.md']).toContain('# Hold: run 2026-09-15-ubqPU2')
    expect(opened).toEqual([])
  })
})

describe('openHold', () => {
  const PATH = 'Maestro/holds/2026-09-15-ubqPU2.md'

  it('opens a hold already written, without asking the engine for anything', async () => {
    notes[PATH] = '# Hold: run 2026-09-15-ubqPU2 · creative-director\n\n## Direction\nKEEP: character-director\n'
    online = false
    await makeDirectRun().openHold('2026-09-15-ubqPU2')
    expect(openedRuns).toEqual(['2026-09-15-ubqPU2'])
    expect(requestedRunIds).toEqual([])
    expect(notes[PATH]).toContain('KEEP: character-director')
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
