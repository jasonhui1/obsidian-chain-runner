import { describe, it, expect, beforeEach } from 'vitest'
import { AskTheRoom, NOBODY_ANSWERED, NOTHING_TO_ASK, NOT_A_HOLD_NOTE } from '@/ui/askTheRoom'
import { holdNoteContent } from '@/run/holdNote'
import type { EngineClient } from '@/engine/client'
import type { AgentOutput, LayoutModel, LayoutPanel, RunEvent, RunMeta, RunRequest } from '@/engine/types'
import type { App, TFile } from 'obsidian'
import { TFile as StubFile } from './obsidian'

/** The "Ask the room" command's order of events; the rule itself is `askRoom.test.ts`. */

const RUN = '2026-09-15-Ab3dE1'
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
let framesByAgent: Record<string, RunEvent[]>
let online: boolean
let requests: RunRequest[]

function file(path: string): TFile {
  const stub = new StubFile()
  stub.path = path
  stub.extension = 'md'
  return stub as unknown as TFile
}

function makeCommand(): AskTheRoom {
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
    getRun: () => Promise.resolve(theRun),
    getLayout: (): Promise<LayoutModel> => Promise.resolve({ kind: 'columns', panels }),
    launchRun: async function* (request: RunRequest) {
      requests.push(request)
      for (const event of framesByAgent[request.agentName ?? ''] ?? []) yield event
    },
  } as unknown as EngineClient

  return new AskTheRoom({
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
  framesByAgent = {}
  online = true
  requests = []
})

describe('start', () => {
  it('says there is nothing to ask when no hold note is open', async () => {
    notes[HOLD_PATH] = 'just some words'
    await makeCommand().start()
    expect(notices).toEqual([NOT_A_HOLD_NOTE])
    expect(requests).toEqual([])
  })

  it('says there is nothing to ask when the Conversation section holds no unanswered question', async () => {
    await makeCommand().start()
    expect(notices).toEqual([NOTHING_TO_ASK])
    expect(requests).toEqual([])
  })

  it('runs every proposer alone, seeded with its prior output and the question', async () => {
    notes[HOLD_PATH] = written() + 'ask the room: is this too much Nier?\n'
    framesByAgent = {
      'character-director': [{ type: 'agent_done', agentName: 'character-director', nodeId: 'character-director', step: 0, output: output('character-director', 'No, the silhouette carries it.') }],
      'gameplay-director': [{ type: 'agent_done', agentName: 'gameplay-director', nodeId: 'gameplay-director', step: 0, output: output('gameplay-director', 'A bit, but the cost sells it.') }],
    }
    await makeCommand().start()
    expect(requests).toHaveLength(2)
    expect(requests.map(request => request.agentName)).toEqual(['character-director', 'gameplay-director'])
    expect(requests[1].seedPrompt).toBe('Stances mapped to segments.\n\nis this too much Nier?')
  })

  it('appends every answer under the question', async () => {
    notes[HOLD_PATH] = written() + 'ask the room: is this too much Nier?\n'
    framesByAgent = {
      'character-director': [{ type: 'agent_done', agentName: 'character-director', nodeId: 'character-director', step: 0, output: output('character-director', 'No.') }],
      'gameplay-director': [{ type: 'agent_done', agentName: 'gameplay-director', nodeId: 'gameplay-director', step: 0, output: output('gameplay-director', 'A bit.') }],
    }
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toContain('ask the room: is this too much Nier?\n> **character-director:**\n> No.\n> **gameplay-director:**\n> A bit.\n')
  })

  it('says nobody answered when every proposer failed', async () => {
    notes[HOLD_PATH] = written() + 'ask the room: is this too much Nier?\n'
    framesByAgent = {
      'character-director': [{ type: 'error', error: 'refused' }],
      'gameplay-director': [{ type: 'error', error: 'refused' }],
    }
    const before = notes[HOLD_PATH]
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toBe(before)
    expect(notices).toEqual([NOBODY_ANSWERED])
  })

  it('says nothing was asked when the engine is offline', async () => {
    online = false
    notes[HOLD_PATH] = written() + 'ask the room: is this too much Nier?\n'
    const before = notes[HOLD_PATH]
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toBe(before)
    expect(requests).toEqual([])
  })

  it('does not change the Direction section', async () => {
    notes[HOLD_PATH] = written() + 'ask the room: is this too much Nier?\n'
    framesByAgent = {
      'character-director': [{ type: 'agent_done', agentName: 'character-director', nodeId: 'character-director', step: 0, output: output('character-director', 'No.') }],
      'gameplay-director': [{ type: 'agent_done', agentName: 'gameplay-director', nodeId: 'gameplay-director', step: 0, output: output('gameplay-director', 'A bit.') }],
    }
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toContain('## Direction\nKEEP:\n')
  })
})
