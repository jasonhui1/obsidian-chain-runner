import { describe, it, expect, beforeEach } from 'vitest'
import { ChatWithProposer, NOTHING_TO_SEND, NOT_A_HOLD_NOTE, NOT_A_PROPOSER } from '@/ui/chatWithProposer'
import { holdNoteContent } from '@/run/holdNote'
import type { EngineClient } from '@/engine/client'
import type { AgentOutput, LayoutModel, LayoutPanel, RunEvent, RunMeta, RunRequest } from '@/engine/types'
import type { App, TFile } from 'obsidian'
import { TFile as StubFile } from './obsidian'

/** The "Chat with proposer" command's order of events; the rule itself is `chat.test.ts`. */

const RUN = '2026-09-15-Ab3dE1'
const NEW = '2026-09-16-Xy9zW2'
const HOLD_PATH = `Maestro/holds/${RUN}.md`

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

function makeCommand(): ChatWithProposer {
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
    getRun: (runId: string) => Promise.resolve(runId === RUN ? theRun : { ...theRun, runId: NEW }),
    getLayout: (runId: string): Promise<LayoutModel> => Promise.resolve({ kind: 'columns', panels: runId === RUN ? panels : panels }),
    launchRun: async function* (request: RunRequest) {
      requests.push(request)
      for (const event of runFrames) yield event
    },
  } as unknown as EngineClient

  return new ChatWithProposer({
    app,
    engine,
    withEngine: async action => (online ? action() : undefined),
    notify: message => void notices.push(message),
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

describe('start, addressing a proposer', () => {
  it('says there is nothing to chat with when no hold note is open', async () => {
    notes[HOLD_PATH] = 'just some words'
    await makeCommand().start()
    expect(notices).toEqual([NOT_A_HOLD_NOTE])
    expect(requests).toEqual([])
  })

  it('says there is nothing to send when the Conversation section holds no unanswered message', async () => {
    await makeCommand().start()
    expect(notices).toEqual([NOTHING_TO_SEND])
    expect(requests).toEqual([])
  })

  it('refuses a join, decider or report node with a one-line reason, and sends nothing', async () => {
    notes[HOLD_PATH] = written() + '@creative-director defend this.\n'
    await makeCommand().start()
    expect(notices).toEqual([NOT_A_PROPOSER('creative-director')])
    expect(requests).toEqual([])
  })

  it('runs the proposer’s agent alone, seeded with its prior output and the message', async () => {
    notes[HOLD_PATH] = written() + '@gameplay-director defend the sleeves\n'
    runFrames = [
      { type: 'run_start', runId: NEW },
      {
        type: 'agent_done',
        agentName: 'gameplay-director',
        nodeId: 'gameplay-director',
        step: 0,
        output: output('gameplay-director', 'Stances read as intent, not a burden — but I can make it cost something.'),
      },
      { type: 'run_complete', runId: NEW },
    ]
    await makeCommand().start()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ agentName: 'gameplay-director', seedPrompt: 'Stances mapped to segments.\n\ndefend the sleeves' })
  })

  it('appends the reply under the message, referencing the prior proposal', async () => {
    notes[HOLD_PATH] = written() + '@gameplay-director defend the sleeves\n'
    runFrames = [
      { type: 'run_start', runId: NEW },
      { type: 'agent_done', agentName: 'gameplay-director', nodeId: 'gameplay-director', step: 0, output: output('gameplay-director', 'Stances defend the sleeves fine.') },
      { type: 'run_complete', runId: NEW },
    ]
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toContain('@gameplay-director defend the sleeves\n> Stances defend the sleeves fine.\n')
  })

  it('says nothing was sent when the engine is offline', async () => {
    online = false
    notes[HOLD_PATH] = written() + '@gameplay-director defend the sleeves\n'
    const before = notes[HOLD_PATH]
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toBe(before)
  })

  it('leaves the note as it was and says so when the chat run failed', async () => {
    notes[HOLD_PATH] = written() + '@gameplay-director defend the sleeves\n'
    const before = notes[HOLD_PATH]
    runFrames = [{ type: 'run_start', runId: NEW }, { type: 'error', error: 'the model refused' }]
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toBe(before)
    expect(notices).toEqual([`Chat with gameplay-director failed: the model refused`])
  })
})

describe('start, revising from a reply', () => {
  it('reruns downstream with the reply as that node’s output, and marks the revise line done', async () => {
    notes[HOLD_PATH] = written() + '@gameplay-director defend the sleeves\n> Halo is a burden, not a toolkit.\nrevise\n'
    runFrames = [{ type: 'run_start', runId: NEW }, { type: 'run_complete', runId: NEW }]
    await makeCommand().start()
    expect(requests).toHaveLength(1)
    expect(requests[0].branchedFromRunId).toBe(RUN)
    expect(requests[0].branchOutputs).toContainEqual(output('gameplay-director', 'Halo is a burden, not a toolkit.'))
    expect(notes[`Maestro/holds/${NEW}.md`]).toContain(`revise → reran as run ${NEW}`)
  })
})
