import { describe, it, expect, beforeEach } from 'vitest'
import { NOT_A_HOLD_NOTE, NOTHING_TO_QUEST, NOT_A_PROPOSER, SideQuest } from '@/ui/sideQuest'
import { holdNoteContent } from '@/run/holdNote'
import type { EngineClient } from '@/engine/client'
import type { AgentOutput, LayoutModel, LayoutPanel, RunEvent, RunMeta, RunRequest } from '@/engine/types'
import type { App, TFile } from 'obsidian'
import { TFile as StubFile } from './obsidian'

/** The "Side quest" command's order of events; the rule itself is `sideQuest.test.ts`. */

const RUN = '2026-09-15-Ab3dE1'
const QUEST_RUN = '2026-09-16-Xy9zW2'
const HOLD_PATH = `Maestro/holds/${RUN}.md`
const ENGINE_URL = 'http://localhost:4000'

const panel = (name: string, text: string, emphasis?: 'join'): LayoutPanel => ({
  name,
  node: name,
  text,
  lines: 1,
  state: 'filled',
  ...(emphasis ? { emphasis } : {}),
})

const output = (nodeId: string, text: string): AgentOutput => ({ nodeId, agentName: nodeId, output: text, status: 'success', timestamp: '' })

const panels = [
  panel('character-director', 'Shrine-maiden silhouette.'),
  panel('gameplay-director', 'Stances mapped to segments.'),
  panel('creative-director', 'Stance-switching combat.', 'join'),
]

const theRun: RunMeta = {
  runId: RUN,
  chainName: 'creative-director',
  seedPrompt: 'anime girl with a halo',
  startedAt: '',
  status: 'complete',
  agentOutputs: [output('character-director', 'Shrine-maiden silhouette.'), output('gameplay-director', 'Stances mapped to segments.')],
}

const questRun: RunMeta = {
  runId: QUEST_RUN,
  chainName: 'combat-lab',
  seedPrompt: 'Stances mapped to segments.',
  startedAt: '',
  status: 'complete',
  agentOutputs: [output('combat-report', 'Stances land as a rhythm system.')],
}

const written = () => holdNoteContent({ runId: RUN, chainName: 'creative-director', panels, thoughts: {} })

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

function makeCommand(): SideQuest {
  const app = {
    workspace: { getActiveFile: () => active ?? null },
    vault: {
      cachedRead: (target: { path: string }) => Promise.resolve(notes[target.path] ?? ''),
      modify: (target: { path: string }, content: string) => {
        notes[target.path] = content
        return Promise.resolve()
      },
    },
  } as unknown as App

  const engine = {
    getRun: (runId: string) => Promise.resolve(runId === RUN ? theRun : questRun),
    getLayout: (): Promise<LayoutModel> => Promise.resolve({ kind: 'columns', panels }),
    launchRun: async function* (request: RunRequest) {
      requests.push(request)
      for (const event of runFrames) yield event
    },
  } as unknown as EngineClient

  return new SideQuest({
    app,
    engine,
    withEngine: async action => (online ? action() : undefined),
    notify: message => void notices.push(message),
    engineUrl: () => ENGINE_URL,
  })
}

beforeEach(() => {
  notes = { [HOLD_PATH]: written() }
  active = file(HOLD_PATH)
  notices = []
  runFrames = []
  online = true
  requests = []
})

describe('start', () => {
  it('says there is nothing to quest when no hold note is open', async () => {
    notes[HOLD_PATH] = 'just some words'
    await makeCommand().start()
    expect(notices).toEqual([NOT_A_HOLD_NOTE])
    expect(requests).toEqual([])
  })

  it('says there is nothing to quest when the Conversation section holds no trigger', async () => {
    await makeCommand().start()
    expect(notices).toEqual([NOTHING_TO_QUEST])
    expect(requests).toEqual([])
  })

  it('refuses a join, decider or report node with a one-line reason, and sends nothing', async () => {
    notes[HOLD_PATH] = written() + 'side quest: @creative-director combat-lab\n'
    await makeCommand().start()
    expect(notices).toEqual([NOT_A_PROPOSER('creative-director')])
    expect(requests).toEqual([])
  })

  it('runs the named chain seeded with the chosen proposal', async () => {
    notes[HOLD_PATH] = written() + 'side quest: @gameplay-director combat-lab\n'
    runFrames = [{ type: 'run_start', runId: QUEST_RUN }, { type: 'run_complete', runId: QUEST_RUN }]
    await makeCommand().start()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ chainName: 'combat-lab', seedPrompt: 'Stances mapped to segments.' })
  })

  it('appends the result and a link to the run under the trigger', async () => {
    notes[HOLD_PATH] = written() + 'side quest: @gameplay-director combat-lab\n'
    runFrames = [{ type: 'run_start', runId: QUEST_RUN }, { type: 'run_complete', runId: QUEST_RUN }]
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toContain(
      `side quest: @gameplay-director combat-lab\n> → [run ${QUEST_RUN}](${ENGINE_URL}/history/${QUEST_RUN})\n> Stances land as a rhythm system.\n`,
    )
  })

  it('does not touch the Direction section', async () => {
    notes[HOLD_PATH] = written() + 'side quest: @gameplay-director combat-lab\n'
    runFrames = [{ type: 'run_start', runId: QUEST_RUN }, { type: 'run_complete', runId: QUEST_RUN }]
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toContain('## Direction\nKEEP:\n')
  })

  it('says nothing was sent when the engine is offline', async () => {
    online = false
    notes[HOLD_PATH] = written() + 'side quest: @gameplay-director combat-lab\n'
    const before = notes[HOLD_PATH]
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toBe(before)
  })

  it('leaves the note as it was and says so when the quest run failed', async () => {
    notes[HOLD_PATH] = written() + 'side quest: @gameplay-director combat-lab\n'
    const before = notes[HOLD_PATH]
    runFrames = [{ type: 'run_start', runId: QUEST_RUN }, { type: 'error', error: 'the model refused' }]
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toBe(before)
    expect(notices).toEqual([`Side quest run ${QUEST_RUN} failed: the model refused`])
  })
})
