import { describe, it, expect, beforeEach } from 'vitest'
import { NO_EDITED_PROPOSAL, NOT_A_HOLD_NOTE, RerunDownstream } from '@/ui/rerunDownstream'
import { holdNoteContent } from '@/run/holdNote'
import type { EngineClient } from '@/engine/client'
import type { AgentOutput, LayoutModel, LayoutPanel, RunEvent, RunMeta, RunRequest } from '@/engine/types'
import type { App, TFile } from 'obsidian'
import { TFile as StubFile } from './obsidian'

/** The order "Rerun downstream" happens in; the rule itself is `rerun.test.ts`. */

const OLD = '2026-09-15-Ab3dE1'
const NEW = '2026-09-16-Xy9zW2'
const HOLD_PATH = `Maestro/holds/${OLD}.md`
const RENAMED_PATH = `Maestro/holds/${NEW}.md`

const panel = (name: string, text: string, emphasis?: 'join'): LayoutPanel => ({
  name,
  node: name,
  text,
  lines: 1,
  state: 'filled',
  ...(emphasis ? { emphasis } : {}),
})

const output = (nodeId: string, text: string): AgentOutput => ({ nodeId, agentName: nodeId, output: text, status: 'success', timestamp: '' })

const oldPanels = [
  panel('character-director', 'Shrine-maiden silhouette.'),
  panel('gameplay-director', 'Stances mapped to segments.'),
  panel('creative-director', 'Stance-switching combat.', 'join'),
]

const oldRun: RunMeta = {
  runId: OLD,
  chainName: 'creative-director',
  seedPrompt: 'anime girl with a halo',
  startedAt: '',
  status: 'complete',
  agentOutputs: [
    output('character-director', 'Shrine-maiden silhouette.'),
    output('gameplay-director', 'Stances mapped to segments.'),
    output('join', 'room'),
    output('creative-director', 'Stance-switching combat.'),
  ],
  graph: {
    edges: [
      { fromNode: 'character-director', toNode: 'join' },
      { fromNode: 'gameplay-director', toNode: 'join' },
      { fromNode: 'join', toNode: 'creative-director' },
    ],
  },
}

const newPanels = [
  panel('character-director', 'Shrine-maiden silhouette.'),
  panel('gameplay-director', 'Halo is a burden.'),
  panel('creative-director', 'Burden-driven combat.', 'join'),
]

const written = () =>
  holdNoteContent({ runId: OLD, chainName: 'creative-director', panels: oldPanels, thoughts: {} }).replace('KEEP:\n', 'KEEP: fast combat\n')

const edited = () => written().replace('Stances mapped to segments.', 'Halo is a burden.')

let active: TFile | undefined
let notes: Record<string, string>
let notices: string[]
let runFrames: RunEvent[]
let online: boolean
let requests: RunRequest[]

function file(path: string): TFile {
  const stub = new StubFile()
  stub.path = path
  stub.extension = 'md'
  return stub as unknown as TFile
}

function makeRerun(): RerunDownstream {
  const app = {
    workspace: { getActiveFile: () => active ?? null },
    vault: {
      getAbstractFileByPath: (path: string) => (notes[path] !== undefined ? file(path) : null),
      cachedRead: (target: { path: string }) => Promise.resolve(notes[target.path] ?? ''),
      modify: (target: { path: string }, content: string) => {
        notes[target.path] = content
        return Promise.resolve()
      },
    },
    fileManager: {
      renameFile: (target: { path: string }, path: string) => {
        notes[path] = notes[target.path]
        delete notes[target.path]
        target.path = path
        return Promise.resolve()
      },
    },
  } as unknown as App

  const engine = {
    getRun: (runId: string) => Promise.resolve(runId === OLD ? oldRun : { ...oldRun, runId: NEW }),
    getLayout: (runId: string): Promise<LayoutModel> =>
      Promise.resolve({ kind: 'columns', panels: runId === OLD ? oldPanels : newPanels }),
    launchRun: async function* (request: RunRequest) {
      requests.push(request)
      for (const event of runFrames) yield event
    },
  } as unknown as EngineClient

  return new RerunDownstream({
    app,
    engine,
    withEngine: async action => (online ? action() : undefined),
    notify: message => void notices.push(message),
  })
}

beforeEach(() => {
  notes = { [HOLD_PATH]: edited() }
  active = file(HOLD_PATH)
  notices = []
  runFrames = [{ type: 'run_start', runId: NEW }, { type: 'run_complete', runId: NEW }]
  online = true
  requests = []
})

describe('start', () => {
  it('says there is nothing to rerun when no hold note is open', async () => {
    notes[HOLD_PATH] = 'just some words'
    await makeRerun().start()
    expect(notices).toEqual([NOT_A_HOLD_NOTE])
    expect(requests).toEqual([])
  })

  it('runs nothing when no proposal was edited', async () => {
    notes[HOLD_PATH] = written()
    await makeRerun().start()
    expect(notices).toEqual([NO_EDITED_PROPOSAL])
    expect(requests).toEqual([])
  })

  it('branches from the hold’s run, replaying all but the edited node’s descendants, with the edit as its output', async () => {
    await makeRerun().start()
    expect(requests).toHaveLength(1)
    expect(requests[0].branchedFromRunId).toBe(OLD)
    expect(requests[0].branchOutputs).toEqual([
      output('character-director', 'Shrine-maiden silhouette.'),
      output('gameplay-director', 'Halo is a burden.'),
    ])
  })

  it('sends the canon file’s text as context, when one exists', async () => {
    notes['context/canon-anime-game.md'] = '## LOCKED\n- halo = burden\n'
    await makeRerun().start()
    expect(requests[0].context).toEqual({ 'canon-anime-game': '## LOCKED\n- halo = burden\n' })
  })

  it('refreshes the note with the new run’s verdict, folding the old one and keeping the Direction', async () => {
    await makeRerun().start()
    const note = notes[RENAMED_PATH]
    expect(note).toContain(`# Hold: run ${NEW} · creative-director`)
    expect(note).toContain('Burden-driven combat.')
    expect(note).toContain('## Previous verdict')
    expect(note).toContain('Stance-switching combat.')
    expect(note).toContain('KEEP: fast combat')
    expect(notices).toEqual([`Reran downstream as run ${NEW}`])
  })

  it('renames the note to the new run, so directing that run finds it', async () => {
    await makeRerun().start()
    expect(Object.keys(notes)).toEqual([RENAMED_PATH])
  })

  it('keeps the note’s name, and says so, when a note for the new run is already there', async () => {
    notes[RENAMED_PATH] = 'another note'
    await makeRerun().start()
    expect(notes[HOLD_PATH]).toContain(`# Hold: run ${NEW} · creative-director`)
    expect(notes[RENAMED_PATH]).toBe('another note')
    expect(notices).toEqual([`Reran downstream as run ${NEW}, but ${RENAMED_PATH} already exists — note not renamed`])
  })

  it('writes nothing when the engine is offline', async () => {
    online = false
    await makeRerun().start()
    expect(notes[HOLD_PATH]).toBe(edited())
  })

  it('leaves the note as it was when the rerun failed, and says so', async () => {
    runFrames = [{ type: 'run_start', runId: NEW }, { type: 'error', error: 'the model refused' }]
    await makeRerun().start()
    expect(notes[HOLD_PATH]).toBe(edited())
    expect(notices).toEqual([`Rerun ${NEW} failed: the model refused`])
  })

  it('keeps words the human added to the note while the rerun was going', async () => {
    runFrames = [{ type: 'run_start', runId: NEW }]
    const pending = makeRerun().start()
    notes[HOLD_PATH] = edited().replace('## Conversation\n', '## Conversation\nwritten mid-run\n')
    await pending
    expect(notes[RENAMED_PATH]).toContain('written mid-run')
  })

  it('leaves the note as is, and says so, when a proposal changed while the rerun was going', async () => {
    runFrames = [{ type: 'run_start', runId: NEW }]
    const pending = makeRerun().start()
    const midRun = edited().replace('Halo is a burden.', 'Halo is a leash.')
    notes[HOLD_PATH] = midRun
    await pending
    expect(notes[HOLD_PATH]).toBe(midRun)
    expect(notices).toEqual([`Reran as run ${NEW}, but proposals changed meanwhile — note left as is`])
  })

  it('also skips the refresh when an edited proposal was reverted back to its original text mid-run — that too differs from what was sent', async () => {
    runFrames = [{ type: 'run_start', runId: NEW }]
    const pending = makeRerun().start()
    notes[HOLD_PATH] = written()
    await pending
    expect(notices).toEqual([`Reran as run ${NEW}, but proposals changed meanwhile — note left as is`])
  })
})
