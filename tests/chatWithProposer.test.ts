import { describe, it, expect, beforeEach } from 'vitest'
import { ChatWithProposer, NOTHING_TO_SEND, NOT_A_HOLD_NOTE, NOT_A_PROPOSER, NOT_THE_ENGINE_S } from '@/ui/chatWithProposer'
import { holdNoteContent } from '@/run/holdNote'
import { RerunWatch } from '@/run/rerunWatch'
import { UNSUPPORTED_PROMOTE } from '@/run/promote'
import type { EngineClient } from '@/engine/client'
import { EngineHttpError } from '@/engine/transport'
import type {
  AgentOutput,
  Capabilities,
  ChatEvent,
  ChatMessage,
  LayoutModel,
  LayoutPanel,
  PromoteRequest,
  RunEvent,
  RunMeta,
  RunRequest,
} from '@/engine/types'
import { MemoryNoteStore } from './memoryNoteStore'

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

/** A node's output, carrying whatever transcript the engine has for it. */
const chatted = (one: AgentOutput): AgentOutput => {
  const conversation = one.nodeId ? conversations[one.nodeId] : undefined
  return conversation ? { ...one, conversation } : one
}

const theRun = (): RunMeta => ({
  runId: RUN,
  chainName: 'creative-director',
  seedPrompt: 'anime girl with a halo',
  startedAt: '',
  status: 'complete',
  agentOutputs: [
    output('character-director', 'Shrine-maiden silhouette.'),
    chatted(output('gameplay-director', 'Stances mapped to segments.')),
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
})

const written = () => holdNoteContent({ runId: RUN, chainName: 'creative-director', panels, thoughts: {} })

let store: MemoryNoteStore
let notes: Record<string, string>
let notices: string[]
let runFrames: RunEvent[]
let online: boolean
let requests: RunRequest[]
let capabilities: Capabilities
/** What the chat endpoint streams; `undefined` is an engine with no such route. */
let chatFrames: ChatEvent[] | undefined
/** What the chat endpoint refuses with, in place of streaming anything. */
let chatRefusal: EngineHttpError | undefined
let chats: { runId: string; nodeId: string; message: string }[]
/** The transcript the engine already holds for a node, by node id. */
let conversations: Record<string, ChatMessage[]>
/** Whether the engine records the turn it just gave, the way a real one does. */
let recordsTurns: boolean
/** What the promote endpoint streams; the run it names is the run of record. */
let promoteFrames: RunEvent[]
/** What the promote endpoint refuses with, in place of streaming anything. */
let promoteRefusal: EngineHttpError | undefined
let promotes: { runId: string; nodeId: string; request: PromoteRequest }[]

function makeCommand(): ChatWithProposer {
  const engine = {
    getRun: (runId: string) => Promise.resolve(runId === RUN ? theRun() : { ...theRun(), runId: NEW }),
    getLayout: (runId: string): Promise<LayoutModel> => Promise.resolve({ kind: 'columns', panels: runId === RUN ? panels : panels }),
    launchRun: async function* (request: RunRequest) {
      requests.push(request)
      for (const event of runFrames) yield event
    },
    capabilities: () => Promise.resolve(capabilities),
    promoteNode: async function* (node: { runId: string; nodeId: string }, request: PromoteRequest) {
      promotes.push({ ...node, request })
      if (promoteRefusal) throw promoteRefusal
      for (const event of promoteFrames) yield event
    },
    chatWithNode: async function* (chat: { runId: string; nodeId: string; message: string }) {
      chats.push(chat)
      if (chatRefusal) throw chatRefusal
      if (chatFrames === undefined) throw new EngineHttpError(404, 'http://engine/chat', 'Not found')
      yield* chatFrames
      // The engine appends the turn to the node's transcript, where a re-read finds it.
      for (const event of recordsTurns ? chatFrames : []) {
        if (event.type === 'chat_done') conversations[chat.nodeId] = [...(conversations[chat.nodeId] ?? []), event.message]
      }
    },
  } as unknown as EngineClient

  return new ChatWithProposer({
    store,
    engine,
    withEngine: async action => (online ? action() : undefined),
    notify: message => void notices.push(message),
    reruns: new RerunWatch(),
  })
}

beforeEach(() => {
  store = new MemoryNoteStore({ [HOLD_PATH]: written() })
  notes = store.notes
  store.inFront = { path: HOLD_PATH }
  notices = []
  runFrames = []
  online = true
  requests = []
  capabilities = { proposerChat: true, nodePromote: true }
  chatFrames = []
  chatRefusal = undefined
  chats = []
  conversations = {}
  recordsTurns = true
  promoteFrames = []
  promoteRefusal = undefined
  promotes = []
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
    expect(chats).toEqual([])
    expect(requests).toEqual([])
  })

  it('sends the message to the proposer’s own node, continuing its transcript', async () => {
    notes[HOLD_PATH] = written() + '@gameplay-director defend the sleeves\n'
    chatFrames = [{ type: 'chat_done', message: { role: 'assistant', content: 'Stances read as intent, not a burden.' } }]
    await makeCommand().start()
    expect(chats).toEqual([{ runId: RUN, nodeId: 'gameplay-director', message: 'defend the sleeves' }])
    // Nothing is launched: the node's own transcript is what continues.
    expect(requests).toEqual([])
  })

  it('appends the reply under the message, with the turn the engine counted it as', async () => {
    notes[HOLD_PATH] = written() + '@gameplay-director defend the sleeves\n'
    chatFrames = [{ type: 'chat_done', message: { role: 'assistant', content: 'Stances defend the sleeves fine.' } }]
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toContain('@gameplay-director defend the sleeves\n> [turn 1]\n> \n> Stances defend the sleeves fine.\n')
  })

  it('counts the reply onto the turns the node’s transcript already holds', async () => {
    conversations = {
      'gameplay-director': [
        { role: 'user', content: 'defend the sleeves' },
        { role: 'assistant', content: 'They read as intent.' },
        { role: 'user', content: 'again' },
        { role: 'assistant', content: 'Still intent.' },
      ],
    }
    notes[HOLD_PATH] = written() + '@gameplay-director once more\n'
    chatFrames = [{ type: 'chat_done', message: { role: 'assistant', content: 'And again.' } }]
    await makeCommand().start()
    // Two replies already, so this is the third — the human's own lines are not turns.
    expect(notes[HOLD_PATH]).toContain('> [turn 3]\n')
  })

  it('takes the turn from the engine’s own transcript, not from a count made before the call', async () => {
    // A turn landed on the node between the run being read and the reply coming back.
    conversations = { 'gameplay-director': [{ role: 'assistant', content: 'From elsewhere.' }] }
    notes[HOLD_PATH] = written() + '@gameplay-director once more\n'
    chatFrames = [{ type: 'chat_done', message: { role: 'assistant', content: 'And again.' } }]
    const command = makeCommand()
    conversations['gameplay-director'] = [
      { role: 'assistant', content: 'From elsewhere.' },
      { role: 'assistant', content: 'And another.' },
    ]
    await command.start()
    expect(notes[HOLD_PATH]).toContain('> [turn 3]\n')
  })

  it('counts on from what it read when the engine records no transcript', async () => {
    recordsTurns = false
    conversations = { 'gameplay-director': [{ role: 'assistant', content: 'Once.' }] }
    notes[HOLD_PATH] = written() + '@gameplay-director once more\n'
    chatFrames = [{ type: 'chat_done', message: { role: 'assistant', content: 'And again.' } }]
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toContain('> [turn 2]\n')
  })

  it('says nothing was sent when the engine is offline', async () => {
    online = false
    notes[HOLD_PATH] = written() + '@gameplay-director defend the sleeves\n'
    const before = notes[HOLD_PATH]
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toBe(before)
  })

  it('leaves the note as it was and says so when the model failed', async () => {
    notes[HOLD_PATH] = written() + '@gameplay-director defend the sleeves\n'
    const before = notes[HOLD_PATH]
    chatFrames = [{ type: 'error', error: 'the model refused' }]
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toBe(before)
    expect(notices).toEqual([`Chat with gameplay-director failed: the model refused`])
  })

  it.each([
    [409, `Run ${RUN} is still running — chat with gameplay-director once it stops`],
    [404, `Run ${RUN} no longer has a node for gameplay-director`],
    [400, 'gameplay-director cannot be chatted with: node is not a proposer'],
    [422, "gameplay-director's agent file is gone from the workspace"],
  ])('writes nothing and says why when the engine refuses with %i', async (status, said) => {
    notes[HOLD_PATH] = written() + '@gameplay-director defend the sleeves\n'
    const before = notes[HOLD_PATH]
    chatRefusal = new EngineHttpError(status, 'http://engine/chat', '{"error":"node is not a proposer"}')
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toBe(before)
    expect(notices).toEqual([said])
  })
})

describe('an engine with no chat endpoint, which falls back to approximate chat', () => {
  beforeEach(() => {
    capabilities = {}
    chatFrames = undefined
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

  it('writes the reply with no turn, since nothing was continued', async () => {
    notes[HOLD_PATH] = written() + '@gameplay-director defend the sleeves\n'
    runFrames = [
      { type: 'run_start', runId: NEW },
      { type: 'agent_done', agentName: 'gameplay-director', nodeId: 'gameplay-director', step: 0, output: output('gameplay-director', 'Stances defend the sleeves fine.') },
      { type: 'run_complete', runId: NEW },
    ]
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toContain('@gameplay-director defend the sleeves\n> Stances defend the sleeves fine.\n')
  })

  it('is not reached by an engine that has the endpoint, however old the run is', async () => {
    capabilities = { proposerChat: true }
    chatFrames = [{ type: 'chat_done', message: { role: 'assistant', content: 'Still here.' } }]
    notes[HOLD_PATH] = written() + '@gameplay-director defend the sleeves\n'
    await makeCommand().start()
    expect(requests).toEqual([])
    expect(notes[HOLD_PATH]).toContain('> [turn 1]\n')
  })
})

describe('start, revising from a reply', () => {
  /** A Conversation ending in a bare `revise`, on a reply the engine counted as `turn` when it gave it one. */
  const toRevise = (turn?: number): string =>
    written() +
    `@gameplay-director defend the sleeves\n${turn === undefined ? '' : `> [turn ${turn}]\n> \n`}> Halo is a burden, not a toolkit.\nrevise\n`

  it('promotes that reply on the proposer’s own node, rather than replaying it as an edit', async () => {
    notes[HOLD_PATH] = toRevise(2)
    promoteFrames = [{ type: 'run_start', runId: RUN }, { type: 'run_complete', runId: RUN }]
    await makeCommand().start()
    expect(promotes).toEqual([{ runId: RUN, nodeId: 'gameplay-director', request: { turn: 2 } }])
    // Nothing is launched: the engine decides what rerunning the promotion means.
    expect(requests).toEqual([])
  })

  it('refuses a reply the engine never counted, which it holds nothing to promote for', async () => {
    notes[HOLD_PATH] = toRevise()
    const before = notes[HOLD_PATH]
    await makeCommand().start()
    expect(promotes).toEqual([])
    expect(notes[HOLD_PATH]).toBe(before)
    expect(notices).toEqual([NOT_THE_ENGINE_S('gameplay-director')])
  })

  it('keeps the note under the run it was called on when the engine reran to the hold in place', async () => {
    notes[HOLD_PATH] = toRevise(2)
    promoteFrames = [{ type: 'run_start', runId: RUN }, { type: 'run_complete', runId: RUN }]
    await makeCommand().start()
    expect(Object.keys(notes)).toEqual([HOLD_PATH])
    expect(notes[HOLD_PATH]).toContain(`revise → reran as run ${RUN}`)
    expect(notices).toEqual([`gameplay-director's reply is now the proposal — run ${RUN} reran`])
  })

  it('moves the note to the fork when the engine named a run other than the one called', async () => {
    notes[HOLD_PATH] = toRevise(2)
    promoteFrames = [{ type: 'run_start', runId: NEW }, { type: 'run_complete', runId: NEW }]
    await makeCommand().start()
    expect(Object.keys(notes)).toEqual([`Maestro/holds/${NEW}.md`])
    expect(notes[`Maestro/holds/${NEW}.md`]).toContain(`revise → reran as run ${NEW}`)
    expect(notices).toEqual([`gameplay-director's reply is now the proposal — forked as run ${NEW}`])
  })

  it.each([
    [400, 'node is inside a loop', "gameplay-director's reply cannot be used as the revision: node is inside a loop"],
    [400, 'turn 4 is out of range', "gameplay-director's reply cannot be used as the revision: turn 4 is out of range"],
    [404, 'unknown node', `Run ${RUN} no longer has a node for gameplay-director`],
    [409, 'run is running', `Run ${RUN} is still running — use gameplay-director's reply once it stops`],
  ])('leaves the note as it was and says why when the engine refuses with %i', async (status, said, notice) => {
    notes[HOLD_PATH] = toRevise(2)
    const before = notes[HOLD_PATH]
    promoteRefusal = new EngineHttpError(status, 'http://engine/promote', JSON.stringify({ error: said }))
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toBe(before)
    expect(notices).toEqual([notice])
  })

  it('leaves the note as it was and says so when the engine cannot promote', async () => {
    notes[HOLD_PATH] = toRevise(2)
    const before = notes[HOLD_PATH]
    capabilities = { proposerChat: true, nodePromote: false }
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toBe(before)
    expect(notices).toEqual([UNSUPPORTED_PROMOTE])
  })

  it('leaves the note as it was when the run the promotion started failed', async () => {
    notes[HOLD_PATH] = toRevise(2)
    const before = notes[HOLD_PATH]
    promoteFrames = [{ type: 'run_start', runId: NEW }, { type: 'error', error: 'the chain broke' }]
    await makeCommand().start()
    expect(notes[HOLD_PATH]).toBe(before)
    expect(notices).toEqual([`Run ${NEW} failed after using gameplay-director's reply: the chain broke`])
  })
})
