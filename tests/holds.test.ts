import { describe, it, expect, beforeEach } from 'vitest'
import {
  ALREADY_GOING,
  Holds,
  NO_EDITED_PROPOSAL,
  NO_HOLD_NOTE,
  NOBODY_ANSWERED,
  NOTHING_PENDING,
  REPLY_NOT_ON_ENGINE,
  PROPOSAL_HEADING,
  type Hold,
  type Landing,
} from '@/ui/holds'
import { directRun, NO_RUN_TO_DIRECT, NOT_A_HOLD_NOTE, rerunDownstreamFront, resumeFront, sendFront } from '@/ui/holdCommands'
import { runViewUrl } from '@/run/provenance'
import { RerunWatch } from '@/run/rerunWatch'
import type { RerunProgress } from '@/run/rerunProgress'
import { UNSUPPORTED_RESUME } from '@/run/resume'
import { EngineHttpError, EngineOfflineError } from '@/engine/transport'
import type {
  AgentOutput,
  Capabilities,
  ChatEvent,
  ChatMessage,
  HoldRecord,
  LayoutModel,
  PromoteRequest,
  ResumeRequest,
  RunEvent,
  RunMeta,
  RunRequest,
} from '@/engine/types'
import { answer, layoutFrame, output, panel, started } from './engineFrames'
import { MemoryNoteStore } from './memoryNoteStore'
import { stubEngine } from './stubEngine'

/**
 * The hold module at its interface: what a hold reads as, what each action
 * leaves in the note, and what it answers — the panel's calls and the
 * palette's alike. The fixture is shaped like a real hold: proposals with
 * headings of their own, a thinking fold, a Direction part-written and ticked,
 * a conversation under way. The note's own grammar is `holdNote.test.ts`,
 * `chat.test.ts` and their neighbours.
 */

const RUN = '2026-09-15-ubqPU2'
const PATH = `Maestro/holds/${RUN}.md`

const HOLD = `# Hold: run ${RUN} · creative-director

Stopped because: chain ended at its declared outputs.

## Verdict (creative-director)

## Creative Thesis
A combat trial in a void.

## Previous verdict

<details>
<summary>run 2026-09-14-old</summary>

An older verdict.

</details>

## Proposals
### gameplay

<details>
<summary>thinking</summary>

Considered a roguelike first.

</details>

## Core verb
Rotate abilities mid-fight.

## Proposed canon
- LOCKED: Abilities rotate randomly during active combat.

### world

## The rule
The world is a test — and someone is watching.

## Proposed canon
- LOCKED: The world is a controlled testing environment.

## Direction
KEEP: gameplay
CHANGE: stability should cost something permanent
KILL:
COMBINE: world + gameplay
PUSH:

CANON?
- [x] LOCKED: Abilities rotate randomly during active combat. — gameplay
- [ ] LOCKED: The world is a test — and someone is watching. — world

## Conversation

@gameplay make it cost something
> Each rotation burns a charge.
revise → reran as run 2026-09-14-old

ask the room: too much Nier?
> **gameplay:**
> A bit.
> **world:**
> No.

side quest: @world combat-lab
> → [run 2026-09-14-quest](http://localhost:4000/history/2026-09-14-quest)
> The test becomes an arena.
>
> Every fight is graded.

@world why a test?
> Someone is watching.
`

const NEW = '2026-09-16-Xy9zW2'
const NEW_PATH = `Maestro/holds/${NEW}.md`
const NONE = '2026-09-15-none'
const QUEST = '2026-09-16-quest1'
const RESUMED = '2026-09-16-Rs1Kq4'
const RESUMED_PATH = `Maestro/holds/${RESUMED}.md`
const ENGINE_URL = 'http://localhost:4000'
const CANON = 'context/canon-anime-game.md'

/** A human's words replayed in place of a node's output: nothing ran, so nothing was spent. */
const revision = (nodeId: string, text: string): AgentOutput => ({ ...output(nodeId, text), tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0 })

const GAMEPLAY = '## Core verb\nRotate abilities mid-fight.\n\n## Proposed canon\n- LOCKED: Abilities rotate randomly during active combat.'
const WORLD = '## The rule\nThe world is a test — and someone is watching.\n\n## Proposed canon\n- LOCKED: The world is a controlled testing environment.'

/** What the run wrote: each proposal as the hold note shows it, unedited. */
const panels = [panel('gameplay', GAMEPLAY), panel('world', WORLD), panel('creative-director', 'A combat trial in a void.', 'join')]

/** The frame a rerun of this hold sends, the named panels still waiting. */
const waitingOn = (...waiting: string[]): RunEvent => layoutFrame(panels, ...waiting)

const questRun: RunMeta = {
  runId: QUEST,
  chainName: 'combat lab',
  seedPrompt: '',
  startedAt: '',
  status: 'complete',
  agentOutputs: [output('sparring', 'A first pass.'), output('combat-report', 'Rotation lands as a rhythm.\n\nKeep it.')],
}

let store: MemoryNoteStore
let notes: Record<string, string>
let notices: string[]
let framesByAgent: Record<string, RunEvent[]>
let rerunFrames: RunEvent[]
let chainFrames: RunEvent[]
let resumeFrames: RunEvent[]
let requests: RunRequest[]
let resumes: { runId: string; request: ResumeRequest }[]
let promotes: { runId: string; nodeId: string; request: PromoteRequest }[]
let online: boolean
let layoutsOf: string[]
let capabilities: Capabilities
/** What the chat endpoint streams; `undefined` is an engine that has no such route. */
let chatFrames: ChatEvent[] | undefined
/** Each chat sent, with the hold note as it read when the engine was asked. */
let chats: { nodeId: string; message: string; noteThen: string | undefined }[]
/** The transcript the engine already holds for a node, by node id. */
let conversations: Record<string, ChatMessage[]>
/** The holds the engine has the run waiting at. */
let waitingAt: HoldRecord[]
/** Holds each streaming call until the test lets it go. */
let gate: Promise<void> | undefined
let reruns: RerunWatch

const theRun = (runId: string): RunMeta => {
  const gameplay = output('gameplay', '## Core verb\nRotate abilities mid-fight.')
  const transcript = conversations.gameplay
  return {
    runId,
    chainName: 'creative-director',
    seedPrompt: 'a combat trial',
    startedAt: '',
    status: 'complete',
    agentOutputs: [
      transcript ? { ...gameplay, conversation: transcript } : gameplay,
      output('world', '## The rule\nThe world is a test.'),
      output('creative-director', 'A combat trial in a void.'),
    ],
    graph: {
      edges: [
        { fromNode: 'gameplay', toNode: 'creative-director' },
        { fromNode: 'world', toNode: 'creative-director' },
      ],
    },
    ...(waitingAt.length > 0 ? { holds: waitingAt } : {}),
  }
}

function makeHolds(): Holds {
  const offline = (): Promise<never> => Promise.reject(new EngineOfflineError(ENGINE_URL))
  const engine = stubEngine({
    capabilities: () => Promise.resolve(capabilities),
    getRun: (runId: string) => (online ? Promise.resolve(runId === QUEST ? questRun : theRun(runId)) : offline()),
    getLayout: (runId: string): Promise<LayoutModel> => {
      if (!online) return offline()
      layoutsOf.push(runId)
      return Promise.resolve({ kind: 'columns', panels })
    },
    waitingRun: (runId: string) => (online ? Promise.resolve(waitingAt.length > 0 ? theRun(runId) : undefined) : offline()),
    launchRun: async function* (request: RunRequest) {
      requests.push(request)
      await gate
      if (request.branchedFromRunId) yield* rerunFrames
      else if (request.agentName) yield* framesByAgent[request.agentName] ?? []
      else yield* chainFrames
    },
    resumeRun: async function* (runId: string, request: ResumeRequest) {
      resumes.push({ runId, request })
      await gate
      yield* resumeFrames
    },
    promoteNode: async function* (node: { runId: string; nodeId: string }, request: PromoteRequest) {
      promotes.push({ ...node, request })
      await gate
      yield* rerunFrames
    },
    chatWithNode: async function* (chat: { nodeId: string; message: string }) {
      chats.push({ ...chat, noteThen: notes[PATH] })
      if (chatFrames === undefined) throw new EngineHttpError(404, `${ENGINE_URL}/chat`, 'Not found')
      yield* chatFrames
    },
  })
  return new Holds({
    store,
    engine,
    withEngine: async action => (online ? action() : undefined),
    notify: message => void notices.push(message),
    reruns,
    runUrl: runId => runViewUrl(ENGINE_URL, runId),
  })
}

const notify = (message: string): void => void notices.push(message)

beforeEach(() => {
  store = new MemoryNoteStore({ [PATH]: HOLD })
  notes = store.notes
  notices = []
  framesByAgent = {}
  rerunFrames = [...started(NEW), { type: 'run_complete', runId: NEW }]
  chainFrames = [...started(QUEST), { type: 'run_complete', runId: QUEST }]
  resumeFrames = started(RUN)
  requests = []
  resumes = []
  promotes = []
  online = true
  layoutsOf = []
  capabilities = {}
  chatFrames = undefined
  chats = []
  conversations = {}
  waitingAt = []
  gate = undefined
  reruns = new RerunWatch()
})

describe('read', () => {
  it('names the run and its chain, and the runs it was under before', async () => {
    const hold = await makeHolds().read(RUN)
    expect(hold).toMatchObject({ runId: RUN, chainName: 'creative-director', earlierRuns: ['2026-09-14-old'] })
  })

  it('finds a hold by a run a rerun moved it on from, and answers the run it is under now', async () => {
    notes[NEW_PATH] = HOLD.replace(`# Hold: run ${RUN}`, `# Hold: run ${NEW}`).replace('<summary>run 2026-09-14-old', `<summary>run ${RUN}`)
    delete notes[PATH]
    expect((await makeHolds().read(RUN))?.runId).toBe(NEW)
  })

  it('tells edited proposals against the run the note names, which a landing writes before it renames the note', async () => {
    notes[PATH] = HOLD.replace(`# Hold: run ${RUN}`, `# Hold: run ${NEW}`)
    expect((await makeHolds().read(RUN))?.runId).toBe(NEW)
    expect(layoutsOf).toEqual([NEW])
  })

  it('is nothing, and says nothing, for a run with no hold note', async () => {
    expect(await makeHolds().read(NONE)).toBeUndefined()
    expect(notices).toEqual([])
  })

  it('reads the verdict, proposals whole, verbs given, the Direction so far and every canon line', async () => {
    const hold = await makeHolds().read(RUN)
    expect(hold?.verdict).toBe('## Creative Thesis\nA combat trial in a void.')
    expect(hold?.proposals.map(({ name, text, given, combinedWith }) => ({ name, text, given, combinedWith }))).toEqual([
      { name: 'gameplay', text: GAMEPLAY, given: ['KEEP', 'COMBINE'], combinedWith: ['world'] },
      { name: 'world', text: WORLD, given: ['COMBINE'], combinedWith: ['gameplay'] },
    ])
    expect(hold?.direction).toEqual(['KEEP: gameplay', 'CHANGE: stability should cost something permanent', 'COMBINE: world + gameplay'])
    expect(hold?.canon.map(({ proposer, ticked }) => ({ proposer, ticked }))).toEqual([
      { proposer: 'gameplay', ticked: true },
      { proposer: 'world', ticked: false },
    ])
  })

  it('marks a proposal whose words differ from what its run wrote, and none while the engine cannot say', async () => {
    notes[PATH] = HOLD.replace('Rotate abilities mid-fight.', 'Rotate stances.')
    expect((await makeHolds().read(RUN))?.proposals.map(one => one.edited)).toEqual([true, false])
    online = false
    expect((await makeHolds().read(RUN))?.proposals.map(one => one.edited)).toEqual([false, false])
  })

  it('asks the engine what a run wrote once, however often the hold is read', async () => {
    const holds = makeHolds()
    await holds.read(RUN)
    await holds.read(RUN)
    expect(layoutsOf).toEqual([RUN])
  })

  it('reads each chat, question and side quest in order', async () => {
    expect((await makeHolds().read(RUN))?.conversation).toEqual([
      { kind: 'chat', name: 'gameplay', message: 'make it cost something', reply: 'Each rotation burns a charge.', revisedAs: '2026-09-14-old' },
      { kind: 'room', question: 'too much Nier?', answers: [{ name: 'gameplay', answer: 'A bit.' }, { name: 'world', answer: 'No.' }] },
      { kind: 'quest', name: 'world', chainName: 'combat-lab', runId: '2026-09-14-quest', result: 'The test becomes an arena.\n\nEvery fight is graded.' },
      { kind: 'chat', name: 'world', message: 'why a test?', reply: 'Someone is watching.' },
    ])
  })

  it('has nothing pending while every trigger line is answered', async () => {
    expect((await makeHolds().read(RUN))?.pending).toBeUndefined()
  })

  it('says which trigger line waits for an answer', async () => {
    const pendingAfter = async (typed: string) => {
      notes[PATH] = HOLD + typed
      return (await makeHolds().read(RUN))?.pending
    }
    expect(await pendingAfter('\n@gameplay and the sleeves?\n')).toEqual({ kind: 'chat', name: 'gameplay', message: 'and the sleeves?' })
    expect(await pendingAfter('\nask the room: louder?\n')).toEqual({ kind: 'room', question: 'louder?' })
    expect(await pendingAfter('\nside quest: @world combat lab\n')).toEqual({ kind: 'quest', name: 'world', chain: 'combat lab' })
    expect(await pendingAfter('revise\n')).toEqual({ kind: 'revise', turn: { name: 'world', message: 'why a test?', reply: 'Someone is watching.' } })
  })
})

describe('front', () => {
  it('is the hold note in front of the reader', async () => {
    store.inFront = { path: PATH }
    expect((await makeHolds().front())?.runId).toBe(RUN)
  })

  it('is nothing, quietly, for a note that is not a hold note, or none', async () => {
    const holds = makeHolds()
    expect(await holds.front()).toBeUndefined()
    notes['Notes/plain.md'] = '# Just words\n'
    store.inFront = { path: 'Notes/plain.md' }
    expect(await holds.front()).toBeUndefined()
    expect(notices).toEqual([])
  })
})

describe('onChange', () => {
  it('tells a listener when the run’s hold note is written, by any hand, and not for any other note', async () => {
    const heard: string[] = []
    const stop = makeHolds().onChange(RUN, () => void heard.push('changed'))
    await store.modify(PATH, HOLD)
    await store.create('Maestro/holds/2026-09-15-other.md', HOLD)
    stop()
    await store.modify(PATH, HOLD)
    expect(heard).toEqual(['changed'])
  })
})

describe('write', () => {
  it('writes a fresh hold note from what the engine recorded, folders and all, and answers it', async () => {
    store = new MemoryNoteStore()
    notes = store.notes
    const hold = await makeHolds().write(NEW, 'creative-director')
    expect(hold?.runId).toBe(NEW)
    expect(notes[NEW_PATH]).toMatch(/^# Hold: run 2026-09-16-Xy9zW2 · creative-director\n/)
    expect(store.folders).toEqual(['Maestro', 'Maestro/holds'])
  })

  it('merges onto a note already written, keeping what the human wrote', async () => {
    await makeHolds().write(RUN)
    expect(notes[PATH]).toContain('CHANGE: stability should cost something permanent')
    expect(notes[PATH]).toContain('@world why a test?\n> Someone is watching.')
  })

  it('writes nothing while the engine is offline', async () => {
    online = false
    expect(await makeHolds().write(NEW)).toBeUndefined()
    expect(notes[NEW_PATH]).toBeUndefined()
  })

  it('says why when the vault refuses it', async () => {
    store.refuse(NEW_PATH)
    expect(await makeHolds().write(NEW)).toBeUndefined()
    expect(notices).toEqual(['Could not write the hold note: the file is read-only'])
  })
})

describe('refresh', () => {
  it('leaves a note alone that shows the holds the engine has open', async () => {
    const hold = await makeHolds().refresh(RUN)
    expect(hold?.runId).toBe(RUN)
    expect(notes[PATH]).toBe(HOLD)
  })

  it('rewrites a note whose holds the engine no longer agrees with', async () => {
    waitingAt = [{ nodeId: 'pick', input: '', candidates: [{ heading: 'Candidate 1', body: 'A trial.' }], reachedAt: 'then' }]
    const hold = await makeHolds().refresh(RUN)
    expect(hold?.holds.map(one => one.nodeId)).toEqual(['pick'])
    expect(notes[PATH]).toContain('## Waiting at pick')
  })

  it('answers the note as it is, quietly, while the engine is offline', async () => {
    online = false
    expect((await makeHolds().refresh(RUN))?.runId).toBe(RUN)
    expect(notices).toEqual([])
  })

  it('is nothing for a run with no hold note', async () => {
    expect(await makeHolds().refresh(NONE)).toBeUndefined()
  })
})

describe('open', () => {
  it('opens the run’s hold note in a tab, or says there is none', async () => {
    const holds = makeHolds()
    await holds.open(RUN)
    await holds.open(NONE)
    expect(store.opened).toEqual([PATH])
    expect(notices).toEqual([NO_HOLD_NOTE(NONE)])
  })
})

describe('direction', () => {
  it('writes a verb’s line at the end of the Direction, and answers the hold as it now reads', async () => {
    const hold = await makeHolds().direct(RUN, 'PUSH', 'world')
    expect(notes[PATH]).toContain('- [ ] LOCKED: The world is a test — and someone is watching. — world\nPUSH: world\n\n## Conversation')
    expect(hold?.proposals[1]?.given).toEqual(['COMBINE', 'PUSH'])
  })

  it('names the second proposal a COMBINE joins', async () => {
    expect((await makeHolds().direct(RUN, 'COMBINE', 'gameplay', 'world'))?.direction.at(-1)).toBe('COMBINE: gameplay + world')
  })

  it('takes a verb back, and a COMBINE whichever way round it was written', async () => {
    const holds = makeHolds()
    await holds.undirect(RUN, 'KEEP', 'gameplay')
    await holds.undirect(RUN, 'COMBINE', 'gameplay', 'world')
    expect(notes[PATH]).toBe(HOLD.replace('KEEP: gameplay\n', '').replace('COMBINE: world + gameplay\n', ''))
  })

  it('ticks and unticks canon lines', async () => {
    const holds = makeHolds()
    const [first, second] = (await holds.read(RUN))!.canon
    await holds.tickCanon(RUN, second!.id, true)
    const hold = await holds.tickCanon(RUN, first!.id, false)
    expect(hold?.canon.map(line => line.ticked)).toEqual([false, true])
  })

  it('picks a candidate, which the hold then reads as chosen', async () => {
    notes[PATH] = HOLD.replace(
      'Stopped because: chain ended at its declared outputs.\n',
      'Stopped because: waiting at pick.\n\n## Waiting at pick\n\nReached then\n\n- [ ] Candidate 1\n  A trial.\n- [ ] Candidate 2\n  A shrine.\n',
    )
    expect((await makeHolds().pickCandidate(RUN, 'pick', 'Candidate 2', true))?.holds.map(hold => hold.chosen)).toEqual(['Candidate 2'])
  })

  it('writes a CHANGE line on one line', async () => {
    expect((await makeHolds().change(RUN, 'rotation should\nhurt'))?.direction.at(-1)).toBe('CHANGE: rotation should hurt')
  })

  it('writes nothing, and says why, for a run with no hold note or a blank change', async () => {
    const holds = makeHolds()
    expect(await holds.direct(NONE, 'KEEP', 'world')).toBeUndefined()
    expect(await holds.change(RUN, '  ')).toBeUndefined()
    expect(Object.keys(notes)).toEqual([PATH])
    expect(notes[PATH]).toBe(HOLD)
    expect(notices).toHaveLength(2)
  })

  it('says why when the vault refuses the write', async () => {
    store.refuse(PATH)
    expect(await makeHolds().direct(RUN, 'KEEP', 'world')).toBeUndefined()
    expect(notices).toEqual(['Could not write the hold note: the file is read-only'])
  })
})

describe('editProposal', () => {
  it('writes the new words in place of the proposal’s, keeping its thinking, and answers it edited', async () => {
    const hold = await makeHolds().editProposal(RUN, 'gameplay', '## Core verb\nRotate stances.\n')
    expect(notes[PATH]).toBe(HOLD.replace(GAMEPLAY, '## Core verb\nRotate stances.'))
    expect(hold?.proposals[0]).toMatchObject({ text: '## Core verb\nRotate stances.', edited: true })
  })

  it('writes nothing, and says why, for a line the note would read as the next proposal', async () => {
    expect(await makeHolds().editProposal(RUN, 'world', 'The world.\n### Another\nMore.')).toBeUndefined()
    expect(notes[PATH]).toBe(HOLD)
    expect(notices).toEqual([PROPOSAL_HEADING])
  })

  it('writes nothing for blank words, or a proposal the hold does not have', async () => {
    const holds = makeHolds()
    expect(await holds.editProposal(RUN, 'world', ' \n ')).toBeUndefined()
    expect(await holds.editProposal(RUN, 'nobody', 'Words.')).toBeUndefined()
    expect(notes[PATH]).toBe(HOLD)
  })
})

describe('chat', () => {
  it('writes the message into the note before the engine is asked, then the reply under it (ADR-0014)', async () => {
    capabilities = { proposerChat: true }
    chatFrames = [{ type: 'chat_done', message: { role: 'assistant', content: 'It keeps fights fresh.' } }]
    const hold = await makeHolds().chat(RUN, 'gameplay', 'why rotate?')
    expect(chats[0]?.noteThen).toBe(`${HOLD}\n@gameplay why rotate?\n`)
    expect(notes[PATH]).toBe(`${HOLD}\n@gameplay why rotate?\n> [turn 1]\n> \n> It keeps fights fresh.\n`)
    expect(hold?.conversation.at(-1)).toEqual({ kind: 'chat', name: 'gameplay', message: 'why rotate?', reply: 'It keeps fights fresh.', turn: 1 })
    expect(hold?.pending).toBeUndefined()
  })

  it('counts a reply onto the turns the node’s transcript already holds', async () => {
    capabilities = { proposerChat: true }
    chatFrames = [{ type: 'chat_done', message: { role: 'assistant', content: 'Still fresh.' } }]
    conversations = { gameplay: [{ role: 'user', content: 'why?' }, { role: 'assistant', content: 'because' }] }
    await makeHolds().chat(RUN, 'gameplay', 'why rotate?')
    expect(notes[PATH]).toContain('> [turn 2]\n')
  })

  it('asks the proposer’s agent alone on an engine without the endpoint, and keeps no turn', async () => {
    framesByAgent = { gameplay: answer('gameplay', 'It keeps fights fresh.\n\nAnd it reads well.') }
    await makeHolds().chat(RUN, 'gameplay', 'why   rotate?')
    expect(requests).toEqual([{ agentName: 'gameplay', seedPrompt: '## Core verb\nRotate abilities mid-fight.\n\nwhy rotate?' }])
    expect(notes[PATH]).toBe(`${HOLD}\n@gameplay why rotate?\n> It keeps fights fresh.\n> \n> And it reads well.\n`)
  })

  it('keeps the chat inside the Conversation when a section follows it', async () => {
    notes[PATH] = `${HOLD}\n## Resumed\n- run 2026-09-15-t59rgo\n`
    framesByAgent = { world: answer('world', 'Because it is.') }
    await makeHolds().chat(RUN, 'world', 'really?')
    expect(notes[PATH]).toBe(`${HOLD}\n@world really?\n> Because it is.\n\n## Resumed\n- run 2026-09-15-t59rgo\n`)
  })

  it('leaves the message in the note when no reply comes, and answers the hold with it pending', async () => {
    framesByAgent = { world: [{ type: 'error', error: 'the model refused' }] }
    const hold = await makeHolds().chat(RUN, 'world', 'really?')
    expect(notes[PATH]).toBe(`${HOLD}\n@world really?\n`)
    expect(notices).toEqual(['Chat with world failed: the model refused'])
    expect(hold?.pending).toEqual({ kind: 'chat', name: 'world', message: 'really?' })
  })

  it('answers nothing when the vault refuses the reply, once a notice has said why', async () => {
    framesByAgent = { world: answer('world', 'Because.') }
    const holds = makeHolds()
    const refusing = store.process.bind(store)
    let writes = 0
    store.process = async (path, edit) => {
      if (++writes === 2) throw new Error('the disk is full')
      return refusing(path, edit)
    }
    expect(await holds.chat(RUN, 'world', 'really?')).toBeUndefined()
    expect(notices).toEqual(['Could not write the hold note: the disk is full'])
  })

  it('leaves the message when the engine is offline', async () => {
    online = false
    expect((await makeHolds().chat(RUN, 'world', 'really?'))?.pending).toMatchObject({ kind: 'chat' })
  })

  it('writes and sends nothing for a blank message, a proposal the hold does not have, or a run with no hold note', async () => {
    const holds = makeHolds()
    expect(await holds.chat(RUN, 'world', '  \n ')).toBeUndefined()
    expect(await holds.chat(RUN, 'nobody', 'hi')).toBeUndefined()
    expect(await holds.chat(NONE, 'world', 'really?')).toBeUndefined()
    expect(notes[PATH]).toBe(HOLD)
    expect(requests).toEqual([])
    expect(notices).toHaveLength(3)
  })
})

describe('askRoom', () => {
  it('writes the question, then every proposer’s answer under it', async () => {
    framesByAgent = { gameplay: answer('gameplay', 'Rotation is the hook.'), world: answer('world', 'The watcher is.') }
    const hold = await makeHolds().askRoom(RUN, 'what is the hook?')
    expect(requests.map(request => request.agentName)).toEqual(['gameplay', 'world'])
    expect(notes[PATH]).toBe(`${HOLD}\nask the room: what is the hook?\n> **gameplay:**\n> Rotation is the hook.\n> **world:**\n> The watcher is.\n`)
    expect(hold?.conversation.at(-1)).toEqual({
      kind: 'room',
      question: 'what is the hook?',
      answers: [
        { name: 'gameplay', answer: 'Rotation is the hook.' },
        { name: 'world', answer: 'The watcher is.' },
      ],
    })
  })

  it('leaves the question, and says so, when nobody answered', async () => {
    framesByAgent = { gameplay: [{ type: 'error', error: 'refused' }], world: [{ type: 'error', error: 'refused' }] }
    const hold = await makeHolds().askRoom(RUN, 'what is the hook?')
    expect(notes[PATH]).toBe(`${HOLD}\nask the room: what is the hook?\n`)
    expect(notices).toEqual([NOBODY_ANSWERED])
    expect(hold?.pending).toEqual({ kind: 'room', question: 'what is the hook?' })
  })

  it('asks nothing for a blank question', async () => {
    expect(await makeHolds().askRoom(RUN, ' ')).toBeUndefined()
    expect(requests).toEqual([])
  })
})

describe('sideQuest', () => {
  it('writes the quest, runs the chain on the proposal as the hold has it, and keeps the result under it', async () => {
    const hold = await makeHolds().sideQuest(RUN, 'gameplay', 'combat lab')
    expect(requests).toEqual([{ chainName: 'combat lab', seedPrompt: GAMEPLAY }])
    expect(notes[PATH]).toBe(
      `${HOLD}\nside quest: @gameplay combat lab\n> → [run ${QUEST}](${ENGINE_URL}/history/${QUEST})\n> Rotation lands as a rhythm.\n> \n> Keep it.\n`,
    )
    expect(hold?.conversation.at(-1)).toEqual({ kind: 'quest', name: 'gameplay', chainName: 'combat lab', runId: QUEST, result: 'Rotation lands as a rhythm.\n\nKeep it.' })
  })

  it('sends a proposal’s edit rather than what its run wrote', async () => {
    const holds = makeHolds()
    await holds.editProposal(RUN, 'world', 'The world is real.')
    await holds.sideQuest(RUN, 'world', 'combat lab')
    expect(requests[0]?.seedPrompt).toBe('The world is real.')
  })

  it('leaves the quest line, and says why, when the run failed', async () => {
    chainFrames = [...started(QUEST), { type: 'error', error: 'the model refused' }]
    const hold = await makeHolds().sideQuest(RUN, 'gameplay', 'combat lab')
    expect(notes[PATH]).toBe(`${HOLD}\nside quest: @gameplay combat lab\n`)
    expect(notices).toEqual([`Side quest run ${QUEST} failed: the model refused`])
    expect(hold?.pending).toEqual({ kind: 'quest', name: 'gameplay', chain: 'combat lab' })
  })

  it('sends nothing for a blank chain or a proposal the hold does not have', async () => {
    const holds = makeHolds()
    expect(await holds.sideQuest(RUN, 'gameplay', '  ')).toBeUndefined()
    expect(await holds.sideQuest(RUN, 'nobody', 'combat lab')).toBeUndefined()
    expect(requests).toEqual([])
  })
})

describe('send, a trigger line typed by hand', () => {
  it('answers a typed message under it', async () => {
    notes[PATH] = `${HOLD}\n@gameplay why rotate?\n`
    framesByAgent = { gameplay: answer('gameplay', 'Fresh fights.') }
    const hold = (await makeHolds().send(RUN, 'chat')) as Hold
    expect(notes[PATH]).toBe(`${HOLD}\n@gameplay why rotate?\n> Fresh fights.\n`)
    expect(hold.pending).toBeUndefined()
  })

  it('says there is nothing to send when every message is answered', async () => {
    expect(await makeHolds().send(RUN, 'chat')).toBeUndefined()
    expect(notices).toEqual([NOTHING_PENDING.chat])
  })

  it('makes a reply the revision on a trailing bare `revise`, marking that line with the run it landed on', async () => {
    notes[PATH] = HOLD.replace('> Someone is watching.\n', '> [turn 2]\n>\n> Someone is watching.\nrevise\n')
    const landing = (await makeHolds().send(RUN, 'chat')) as Landing
    expect(promotes).toEqual([{ runId: RUN, nodeId: 'world', request: { turn: 2 } }])
    expect(landing.hold.runId).toBe(NEW)
    expect(notes[NEW_PATH]).toContain(`> Someone is watching.\nrevise → reran as run ${NEW}\n`)
  })
})

describe('the panel and the palette write the same note', () => {
  const both = async (panel: (holds: Holds) => Promise<unknown>, typed: string, kind: 'chat' | 'room' | 'quest'): Promise<[string, string]> => {
    await panel(makeHolds())
    const fromPanel = notes[PATH]!
    notes[PATH] = HOLD + typed
    store.inFront = { path: PATH }
    await sendFront(makeHolds(), notify, kind)
    return [fromPanel, notes[PATH]!]
  }

  it('for a chat', async () => {
    framesByAgent = { gameplay: answer('gameplay', 'Fresh fights.') }
    const [fromPanel, fromPalette] = await both(holds => holds.chat(RUN, 'gameplay', 'why rotate?'), '\n@gameplay why rotate?\n', 'chat')
    expect(fromPalette).toBe(fromPanel)
    expect(notices).toEqual(['gameplay replied'])
  })

  it('for a question to the room', async () => {
    framesByAgent = { gameplay: answer('gameplay', 'Rotation.'), world: answer('world', 'The watcher.') }
    const [fromPanel, fromPalette] = await both(holds => holds.askRoom(RUN, 'the hook?'), '\nask the room: the hook?\n', 'room')
    expect(fromPalette).toBe(fromPanel)
    expect(notices).toEqual(['The room answered (2)'])
  })

  it('for a side quest', async () => {
    const [fromPanel, fromPalette] = await both(holds => holds.sideQuest(RUN, 'world', 'combat lab'), '\nside quest: @world combat lab\n', 'quest')
    expect(fromPalette).toBe(fromPanel)
    expect(notices).toEqual([`Side quest ran as ${QUEST}`])
  })

  it('for a revise', async () => {
    const replied = HOLD.replace('> Someone is watching.\n', '> [turn 2]\n>\n> Someone is watching.\n')
    notes[PATH] = replied
    await makeHolds().revise(RUN, { name: 'world', message: 'why a test?', reply: 'Someone is watching.', turn: 2 })
    const fromPanel = notes[NEW_PATH]
    store = new MemoryNoteStore({ [PATH]: `${replied}revise\n` })
    notes = store.notes
    store.inFront = { path: PATH }
    await sendFront(makeHolds(), notify, 'chat')
    expect(notes[NEW_PATH]).toBe(fromPanel)
  })

  it('for a rerun downstream', async () => {
    const edited = HOLD.replace('Rotate abilities mid-fight.', 'Rotate stances.')
    notes[PATH] = edited
    await makeHolds().rerun(RUN)
    const fromPanel = notes[NEW_PATH]
    store = new MemoryNoteStore({ [PATH]: edited })
    notes = store.notes
    store.inFront = { path: PATH }
    await rerunDownstreamFront(makeHolds(), notify)
    expect(notes[NEW_PATH]).toBe(fromPanel)
  })

  it('for a resume, canon and all', async () => {
    await makeHolds().resume(RUN)
    const fromPanel = { ...notes }
    store = new MemoryNoteStore({ [PATH]: HOLD })
    notes = store.notes
    store.inFront = { path: PATH }
    await resumeFront(makeHolds(), notify)
    expect(notes).toEqual(fromPanel)
  })

  it('answers a panel chat the engine failed later, from the palette', async () => {
    framesByAgent = { world: [{ type: 'error', error: 'busy' }] }
    await makeHolds().chat(RUN, 'world', 'really?')
    framesByAgent = { world: answer('world', 'Really.') }
    store.inFront = { path: PATH }
    await sendFront(makeHolds(), notify, 'chat')
    expect(notes[PATH]).toBe(`${HOLD}\n@world really?\n> Really.\n`)
  })
})

describe('rerun', () => {
  it('reruns downstream from the hold’s run, each edited proposal’s words as its output', async () => {
    const holds = makeHolds()
    await holds.editProposal(RUN, 'world', 'The world is real.')
    await holds.rerun(RUN)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.branchedFromRunId).toBe(RUN)
    expect(requests[0]?.branchOutputs).toContainEqual(revision('world', 'The world is real.'))
    expect(requests[0]?.branchOutputs).toContainEqual(output('gameplay', '## Core verb\nRotate abilities mid-fight.'))
  })

  it('lands the hold on the run it reran as, folding the old verdict and renaming the note', async () => {
    const holds = makeHolds()
    await holds.editProposal(RUN, 'world', 'The world is real.')
    const landing = await holds.rerun(RUN)
    expect(landing).toMatchObject({ forked: false, hold: { runId: NEW, earlierRuns: [RUN, '2026-09-14-old'] } })
    expect(Object.keys(notes)).toEqual([NEW_PATH])
    expect(notices).toEqual([`Reran downstream as run ${NEW}`])
  })

  it('tells the watch it landed, whether or not the caller listens', async () => {
    const landed: string[] = []
    reruns.onLanding(async landing => void landed.push(`${landing.from.join(',')} → ${landing.runId}`))
    const holds = makeHolds()
    await holds.editProposal(RUN, 'world', 'The world is real.')
    await holds.rerun(RUN)
    expect(landed).toEqual([`${RUN},2026-09-14-old → ${NEW}`])
  })

  it('runs nothing, and says why, when no proposal is edited', async () => {
    expect(await makeHolds().rerun(RUN)).toBeUndefined()
    expect(requests).toEqual([])
    expect(notices).toEqual([NO_EDITED_PROPOSAL])
  })

  it('leaves the hold where it was when the rerun fails', async () => {
    rerunFrames = [...started(NEW), { type: 'error', error: 'the chain broke' }]
    const holds = makeHolds()
    await holds.editProposal(RUN, 'world', 'The world is real.')
    expect(await holds.rerun(RUN)).toBeUndefined()
    expect(Object.keys(notes)).toEqual([PATH])
    expect(notices).toEqual([`Rerun ${NEW} failed: the chain broke`])
  })

  it('tells the caller and the watch what it writes again, then each step the engine starts', async () => {
    rerunFrames = [
      ...started(NEW),
      waitingOn('creative-director'),
      { type: 'agent_start', agentName: 'critic', nodeId: 'scratch', step: 0 },
      { type: 'agent_start', agentName: 'director', nodeId: 'creative-director', step: 1 },
      { type: 'run_complete', runId: NEW },
    ]
    const watched: (RerunProgress | undefined)[] = []
    reruns.onChange(() => void watched.push(reruns.rewriting(RUN, 'creative-director')))
    const holds = makeHolds()
    await holds.editProposal(RUN, 'world', 'The world is real.')
    const heard: RerunProgress[] = []
    await holds.rerun(RUN, progress => heard.push(progress))
    const plan = { verdict: true, proposals: [], cards: ['creative-director'] }
    expect(heard).toEqual([
      plan,
      { ...plan, step: { name: 'critic', writesVerdict: false } },
      { ...plan, step: { name: 'creative-director', writesVerdict: true } },
    ])
    expect(watched).toEqual([...heard, undefined])
  })

  it('refuses a second rerun, revise or resume of the same hold while one goes', async () => {
    let release = (): void => {}
    gate = new Promise(resolve => (release = resolve))
    const holds = makeHolds()
    await holds.editProposal(RUN, 'world', 'The world is real.')
    const first = holds.rerun(RUN)
    expect(await holds.resume(RUN)).toBeUndefined()
    expect(await holds.rerun('2026-09-14-old')).toBeUndefined()
    expect(notices).toEqual([ALREADY_GOING, ALREADY_GOING])
    release()
    expect((await first)?.hold.runId).toBe(NEW)
  })
})

describe('revise', () => {
  const said = { name: 'world', message: 'why a test?', reply: 'Someone is watching.' }
  /** The reply as the engine counted it; only a turn it recorded can be promoted. */
  const turn = { ...said, turn: 2 }

  it('promotes that reply on the proposal’s own node, rather than replaying it as an edit', async () => {
    await makeHolds().revise(RUN, turn)
    expect(promotes).toEqual([{ runId: RUN, nodeId: 'world', request: { turn: 2 } }])
    expect(requests).toEqual([])
  })

  it('lands on the run the stream names, and marks that reply revised as it', async () => {
    const landing = await makeHolds().revise(RUN, turn)
    expect(landing?.hold.conversation.at(-1)).toEqual({ kind: 'chat', ...said, revisedAs: NEW })
    expect(landing?.forked).toBe(true)
    expect(Object.keys(notes)).toEqual([NEW_PATH])
  })

  it('keeps the note under the run it was called on when the engine reran to the hold in place', async () => {
    rerunFrames = [...started(RUN), { type: 'run_complete', runId: RUN }]
    const landing = await makeHolds().revise(RUN, turn)
    expect(landing).toMatchObject({ forked: false, hold: { runId: RUN } })
    expect(Object.keys(notes)).toEqual([PATH])
  })

  it('refuses a reply the engine never counted', async () => {
    expect(await makeHolds().revise(RUN, said)).toBeUndefined()
    expect(promotes).toEqual([])
    expect(notices).toEqual([REPLY_NOT_ON_ENGINE('world')])
  })

  it('leaves the hold where it was when the rerun fails', async () => {
    rerunFrames = [...started(NEW), { type: 'error', error: 'the chain broke' }]
    expect(await makeHolds().revise(RUN, turn)).toBeUndefined()
    expect(notes[PATH]).toBe(HOLD)
    expect(notices).toEqual([`Run ${NEW} failed after using world's reply: the chain broke`])
  })
})

describe('resume', () => {
  it('posts the Direction to the hold’s own run, with canon as its context', async () => {
    notes[CANON] = '## LOCKED\n- an older commitment\n'
    await makeHolds().resume(RUN)
    expect(resumes).toEqual([
      {
        runId: RUN,
        request: {
          direction: expect.stringContaining('KEEP: gameplay') as string,
          context: { 'canon-anime-game': '## LOCKED\n- an older commitment\n' },
        },
      },
    ])
  })

  it('carries on in place: ticks locked, the run linked back, the hold answered as it now reads', async () => {
    const resumed = await makeHolds().resume(RUN)
    expect(resumed).toMatchObject({ forked: false, canon: 'written', hold: { runId: RUN } })
    expect(notes[CANON]).toContain('- Abilities rotate randomly during active combat.')
    expect(notes[CANON]).not.toContain('someone is watching')
    expect(notes[PATH]).toContain(`## Resumed\n- [run ${RUN}](${ENGINE_URL}/history/${RUN})\n`)
  })

  it('writes a fork its own hold, refreshes the one it forked from, and answers the fork’s', async () => {
    resumeFrames = started(RESUMED)
    const resumed = await makeHolds().resume(RUN)
    expect(resumed).toMatchObject({ forked: true, hold: { runId: RESUMED } })
    expect(notes[RESUMED_PATH]).toMatch(/^# Hold: run 2026-09-16-Rs1Kq4 · creative-director/)
    expect(notes[PATH]).toContain(`forked as [run ${RESUMED}]`)
  })

  it('moves the drawing on to a fork, as a rerun’s landing does', async () => {
    resumeFrames = started(RESUMED)
    const landed: string[] = []
    reruns.onLanding(async landing => void landed.push(`${landing.from.join(',')} → ${landing.runId}`))
    await makeHolds().resume(RUN)
    expect(landed).toEqual([`${RUN},2026-09-14-old → ${RESUMED}`])
  })

  it('answers nothing for a fork whose hold could not be written, once a notice has said why', async () => {
    resumeFrames = started(RESUMED)
    store.refuse(RESUMED_PATH)
    expect(await makeHolds().resume(RUN)).toBeUndefined()
    expect(notices).toEqual(['Could not write the hold note: the file is read-only'])
  })

  it('reports a failed run and holds its canon back', async () => {
    resumeFrames = [...started(RUN), { type: 'error', error: 'the model refused' }]
    expect(await makeHolds().resume(RUN)).toMatchObject({ hold: { runId: RUN }, error: 'the model refused', canon: 'held-back' })
    expect(notes[CANON]).toBeUndefined()
  })

  it('says so when the hold note is gone by the time the run carries on', async () => {
    let release = (): void => {}
    gate = new Promise(resolve => (release = resolve))
    const resuming = makeHolds().resume(RUN)
    await new Promise(resolve => setTimeout(resolve, 0))
    delete notes[PATH]
    release()
    expect(await resuming).toBeUndefined()
    expect(notices.at(-1)).toBe(NO_HOLD_NOTE(RUN))
  })

  it('tells the caller how the run is getting on', async () => {
    resumeFrames = [...started(RUN), waitingOn('creative-director'), { type: 'agent_start', agentName: 'director', nodeId: 'creative-director', step: 0 }]
    const heard: RerunProgress[] = []
    await makeHolds().resume(RUN, progress => heard.push(progress))
    expect(heard.at(-1)?.step).toEqual({ name: 'creative-director', writesVerdict: true })
  })

  it('says why when the engine cannot resume a hold', async () => {
    capabilities = { runResume: false }
    expect(await makeHolds().resume(RUN)).toBeUndefined()
    expect(notices).toEqual([UNSUPPORTED_RESUME])
  })

  it('has nothing to answer while the engine is offline, or for a run with no hold note', async () => {
    const holds = makeHolds()
    expect(await holds.resume(NONE)).toBeUndefined()
    online = false
    expect(await holds.resume(RUN)).toBeUndefined()
    expect(resumes).toEqual([])
  })
})

describe('the palette', () => {
  it('says to open a hold note when the note in front is not one', async () => {
    const holds = makeHolds()
    await resumeFront(holds, notify)
    await rerunDownstreamFront(holds, notify)
    await sendFront(holds, notify, 'room')
    expect(notices).toEqual([NOT_A_HOLD_NOTE, NOT_A_HOLD_NOTE, NOT_A_HOLD_NOTE])
  })

  it('resumes the note in front, and says where it carried on', async () => {
    store.inFront = { path: PATH }
    resumeFrames = started(RESUMED)
    await resumeFront(makeHolds(), notify)
    expect(notices).toEqual([`Resumed — forked as run ${RESUMED}`])
  })

  it('reruns the note in front', async () => {
    notes[PATH] = HOLD.replace('Rotate abilities mid-fight.', 'Rotate stances.')
    store.inFront = { path: PATH }
    await rerunDownstreamFront(makeHolds(), notify)
    expect(notices).toEqual([`Reran downstream as run ${NEW}`])
  })

  it('directs the run on screen: writes its hold note and opens it', async () => {
    await directRun(makeHolds(), notify, { runId: NEW, chainName: 'creative-director', status: 'complete' } as never)
    expect(store.opened).toEqual([NEW_PATH])
    expect(notices).toEqual([`Wrote the hold note for run ${NEW}`])
  })

  it('has no run to direct while nothing finished is on screen', async () => {
    await directRun(makeHolds(), notify, undefined)
    expect(notices).toEqual([NO_RUN_TO_DIRECT])
  })
})
