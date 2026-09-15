import { describe, it, expect, beforeEach } from 'vitest'
import { HoldActions } from '@/ui/holdActions'
import { HoldNotes } from '@/ui/holdNotes'
import { AskTheRoom, NOBODY_ANSWERED } from '@/ui/askTheRoom'
import { ChatWithProposer } from '@/ui/chatWithProposer'
import type { EngineClient } from '@/engine/client'
import type { AgentOutput, LayoutModel, LayoutPanel, RunEvent, RunMeta, RunRequest } from '@/engine/types'
import type { App, TAbstractFile, TFile } from 'obsidian'
import { TFile as StubFile } from './obsidian'

/**
 * The hold-actions layer the directing panel talks to: what it reads out of a
 * hold note, and what its actions leave on disk. The fixture is shaped like a
 * real hold — proposals with headings of their own, a thinking fold, a
 * Direction already part-written and ticked, a conversation under way.
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

@world why a test?
> Someone is watching.
`

const NEW = '2026-09-16-Xy9zW2'
const NEW_PATH = `Maestro/holds/${NEW}.md`

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
  panel('gameplay', '## Core verb\nRotate abilities mid-fight.'),
  panel('world', '## The rule\nThe world is a test.'),
  panel('creative-director', 'A combat trial in a void.', 'join'),
]

const theRun = (runId: string): RunMeta => ({
  runId,
  chainName: 'creative-director',
  seedPrompt: 'a combat trial',
  startedAt: '',
  status: 'complete',
  agentOutputs: [
    output('gameplay', '## Core verb\nRotate abilities mid-fight.'),
    output('world', '## The rule\nThe world is a test.'),
    output('creative-director', 'A combat trial in a void.'),
  ],
  graph: {
    edges: [
      { fromNode: 'gameplay', toNode: 'creative-director' },
      { fromNode: 'world', toNode: 'creative-director' },
    ],
  },
})

const answer = (agentName: string, text: string): RunEvent[] => [
  { type: 'agent_done', agentName, nodeId: agentName, step: 0, output: output(agentName, text) },
]

let notes: Record<string, string>
let notices: string[]
let listeners: { name: string; callback: (file: TAbstractFile) => void; removed: boolean }[]
let written: string[]
let openedInTab: string[]
let framesByAgent: Record<string, RunEvent[]>
let rerunFrames: RunEvent[]
let requests: RunRequest[]
let online: boolean

function file(path: string): TFile {
  const stub = new StubFile()
  stub.path = path
  return stub as unknown as TFile
}

function makeActions(): HoldActions {
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (notes[path] !== undefined ? file(path) : null),
      cachedRead: (target: { path: string }) => Promise.resolve(notes[target.path] ?? ''),
      process: (target: { path: string }, edit: (data: string) => string) => {
        if (notes[target.path] === '!refuse') return Promise.reject(new Error('the file is read-only'))
        notes[target.path] = edit(notes[target.path] ?? '')
        return Promise.resolve(notes[target.path])
      },
      modify: (target: { path: string }, content: string) => Promise.resolve(void (notes[target.path] = content)),
      on: (name: string, callback: (file: TAbstractFile) => void) => {
        const listener = { name, callback, removed: false }
        listeners.push(listener)
        return listener
      },
      offref: (ref: { removed: boolean }) => void (ref.removed = true),
    },
    fileManager: {
      renameFile: (target: { path: string }, path: string) => {
        notes[path] = notes[target.path]!
        delete notes[target.path]
        return Promise.resolve()
      },
    },
    workspace: {
      getLeaf: () => ({ openFile: (target: { path: string }) => Promise.resolve(void openedInTab.push(target.path)) }),
    },
  } as unknown as App
  const engine = {
    getRun: (runId: string) => Promise.resolve(theRun(runId)),
    getLayout: (): Promise<LayoutModel> => Promise.resolve({ kind: 'columns', panels }),
    launchRun: async function* (request: RunRequest) {
      requests.push(request)
      yield* request.branchedFromRunId ? rerunFrames : (framesByAgent[request.agentName ?? ''] ?? [])
    },
  } as unknown as EngineClient
  const notify = (message: string): void => void notices.push(message)
  const withEngine = async <T>(action: () => Promise<T>): Promise<T | undefined> => (online ? action() : undefined)
  return new HoldActions({
    app,
    notify,
    notes: new HoldNotes({ app, notify }),
    write: runId => Promise.resolve(void written.push(runId)),
    chat: new ChatWithProposer({ app, engine, withEngine, notify }),
    room: new AskTheRoom({ app, engine, withEngine, notify }),
  })
}

function touch(name: string, path: string): void {
  for (const listener of listeners.filter(one => one.name === name && !one.removed)) listener.callback(file(path))
}

beforeEach(() => {
  notes = { [PATH]: HOLD }
  notices = []
  listeners = []
  written = []
  openedInTab = []
  framesByAgent = {}
  rerunFrames = []
  requests = []
  online = true
})

describe('read', () => {
  it('names the run and its chain', async () => {
    const hold = await makeActions().read(RUN)
    expect(hold?.runId).toBe(RUN)
    expect(hold?.chainName).toBe('creative-director')
  })

  it('is nothing for a run with no hold note', async () => {
    expect(await makeActions().read('2026-09-15-none')).toBeUndefined()
  })

  it('reads the verdict, headings and all, and not the verdicts before it', async () => {
    const hold = await makeActions().read(RUN)
    expect(hold?.verdict).toBe('## Creative Thesis\nA combat trial in a void.')
  })

  it('has no verdict when the run did not converge', async () => {
    notes[PATH] = HOLD.replace(/## Verdict[\s\S]*?(?=## Proposals)/, '')
    expect((await makeActions().read(RUN))?.verdict).toBeUndefined()
  })

  it('reads each proposal whole, its own headings kept and its thinking left out', async () => {
    const hold = await makeActions().read(RUN)
    expect(hold?.proposals.map(proposal => proposal.name)).toEqual(['gameplay', 'world'])
    expect(hold?.proposals[0]?.text).toBe(
      '## Core verb\nRotate abilities mid-fight.\n\n## Proposed canon\n- LOCKED: Abilities rotate randomly during active combat.',
    )
  })

  it('marks the verbs already given to each proposal, COMBINE on both it names', async () => {
    const hold = await makeActions().read(RUN)
    expect(hold?.proposals.map(proposal => proposal.given)).toEqual([['KEEP', 'COMBINE'], ['COMBINE']])
  })

  it('names who each proposal is already combined with', async () => {
    const hold = await makeActions().read(RUN)
    expect(hold?.proposals.map(proposal => proposal.combinedWith)).toEqual([['world'], ['gameplay']])
  })

  it('reads the Direction so far, without the empty verbs or the canon checklist', async () => {
    const hold = await makeActions().read(RUN)
    expect(hold?.direction).toEqual(['KEEP: gameplay', 'CHANGE: stability should cost something permanent', 'COMBINE: world + gameplay'])
  })

  it('reads every canon line: its words, who offered it, and whether it is ticked', async () => {
    const hold = await makeActions().read(RUN)
    expect(hold?.canon.map(({ text, proposer, ticked }) => ({ text, proposer, ticked }))).toEqual([
      { text: 'LOCKED: Abilities rotate randomly during active combat.', proposer: 'gameplay', ticked: true },
      { text: 'LOCKED: The world is a test — and someone is watching.', proposer: 'world', ticked: false },
    ])
  })
})

describe('direct', () => {
  it('writes the verb’s line at the end of the Direction on disk', async () => {
    await makeActions().direct(RUN, 'PUSH', 'world')
    expect(notes[PATH]).toContain('- [ ] LOCKED: The world is a test — and someone is watching. — world\nPUSH: world\n\n## Conversation')
  })

  it('names the second proposal a COMBINE joins', async () => {
    const actions = makeActions()
    await actions.direct(RUN, 'COMBINE', 'gameplay', 'world')
    expect((await actions.read(RUN))?.direction.at(-1)).toBe('COMBINE: gameplay + world')
  })

  it('writes nothing for a run with no hold note', async () => {
    await makeActions().direct('2026-09-15-none', 'KEEP', 'world')
    expect(Object.keys(notes)).toEqual([PATH])
  })

  it('says why when the vault refuses the write', async () => {
    notes[PATH] = '!refuse'
    await makeActions().direct(RUN, 'KEEP', 'world')
    expect(notices).toEqual(['Could not write the hold note: the file is read-only'])
  })
})

describe('undirect', () => {
  it('takes a verb back off a proposal, leaving the rest of the Direction as it was', async () => {
    await makeActions().undirect(RUN, 'KEEP', 'gameplay')
    expect(notes[PATH]).toBe(HOLD.replace('KEEP: gameplay\n', ''))
  })

  it('takes a COMBINE back whichever way round it was written', async () => {
    await makeActions().undirect(RUN, 'COMBINE', 'gameplay', 'world')
    expect(notes[PATH]).toBe(HOLD.replace('COMBINE: world + gameplay\n', ''))
  })

  it('leaves a verb written for another proposal alone', async () => {
    await makeActions().undirect(RUN, 'KEEP', 'world')
    expect(notes[PATH]).toBe(HOLD)
  })
})

describe('tickCanon', () => {
  it('ticks a canon line on disk, and touches no other', async () => {
    const actions = makeActions()
    const line = (await actions.read(RUN))!.canon[1]!
    await actions.tickCanon(RUN, line.id, true)
    expect(notes[PATH]).toBe(HOLD.replace('- [ ] LOCKED: The world', '- [x] LOCKED: The world'))
  })

  it('unticks one', async () => {
    const actions = makeActions()
    const line = (await actions.read(RUN))!.canon[0]!
    await actions.tickCanon(RUN, line.id, false)
    expect((await actions.read(RUN))?.canon.map(canon => canon.ticked)).toEqual([false, false])
  })

  it('leaves a note whose line is already gone as it was', async () => {
    await makeActions().tickCanon(RUN, 'LOCKED: a line nobody offered. — world', true)
    expect(notes[PATH]).toBe(HOLD)
  })
})

describe('read, the conversation', () => {
  it('reads each chat and question in order: replies, answers, and the run a reply was revised as', async () => {
    const hold = await makeActions().read(RUN)
    expect(hold?.conversation).toEqual([
      { kind: 'chat', name: 'gameplay', message: 'make it cost something', reply: 'Each rotation burns a charge.', revisedAs: '2026-09-14-old' },
      { kind: 'room', question: 'too much Nier?', answers: [{ name: 'gameplay', answer: 'A bit.' }, { name: 'world', answer: 'No.' }] },
      { kind: 'chat', name: 'world', message: 'why a test?', reply: 'Someone is watching.' },
    ])
  })

  it('reads a message still waiting for its reply', async () => {
    notes[PATH] = HOLD + '@gameplay and the sleeves?\n'
    expect((await makeActions().read(RUN))?.conversation.at(-1)).toEqual({ kind: 'chat', name: 'gameplay', message: 'and the sleeves?' })
  })

  it('is empty before anyone has talked', async () => {
    notes[PATH] = HOLD.slice(0, HOLD.indexOf('## Conversation') + '## Conversation\n'.length)
    expect((await makeActions().read(RUN))?.conversation).toEqual([])
  })
})

describe('chat', () => {
  it('asks the proposer’s agent alone, seeded with its proposal and the message', async () => {
    framesByAgent = { gameplay: answer('gameplay', 'It keeps fights fresh.') }
    await makeActions().chat(RUN, 'gameplay', 'why rotate?')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ agentName: 'gameplay', seedPrompt: '## Core verb\nRotate abilities mid-fight.\n\nwhy rotate?' })
  })

  it('writes the message and its reply at the end of the Conversation, where the read finds them', async () => {
    framesByAgent = { gameplay: answer('gameplay', 'It keeps fights fresh.\n\nAnd it reads well.') }
    const actions = makeActions()
    expect(await actions.chat(RUN, 'gameplay', 'why rotate?')).toBe(true)
    expect(notes[PATH]).toBe(`${HOLD}\n@gameplay why rotate?\n> It keeps fights fresh.\n> \n> And it reads well.\n`)
    expect((await actions.read(RUN))?.conversation.at(-1)).toEqual({
      kind: 'chat',
      name: 'gameplay',
      message: 'why rotate?',
      reply: 'It keeps fights fresh.\n\nAnd it reads well.',
    })
  })

  it('keeps the chat inside the Conversation when a section follows it', async () => {
    notes[PATH] = `${HOLD}\n## Resumed\n- develop-direction run 2026-09-15-t59rgo\n`
    framesByAgent = { world: answer('world', 'Because it is.') }
    await makeActions().chat(RUN, 'world', 'really?')
    expect(notes[PATH]).toBe(`${HOLD}\n@world really?\n> Because it is.\n\n## Resumed\n- develop-direction run 2026-09-15-t59rgo\n`)
  })

  it('sends a message typed over several lines as one', async () => {
    framesByAgent = { world: answer('world', 'Yes.') }
    await makeActions().chat(RUN, 'world', '  is it\nstill a test? ')
    expect(requests[0]?.seedPrompt).toMatch(/is it still a test\?$/)
    expect(notes[PATH]).toContain('\n@world is it still a test?\n> Yes.\n')
  })

  it('writes nothing, and says why, when the proposer gives no reply', async () => {
    framesByAgent = { world: [{ type: 'error', error: 'the model refused' }] }
    expect(await makeActions().chat(RUN, 'world', 'really?')).toBe(false)
    expect(notes[PATH]).toBe(HOLD)
    expect(notices).toEqual(['Chat with world failed: the model refused'])
  })

  it('writes nothing when the engine is offline', async () => {
    online = false
    expect(await makeActions().chat(RUN, 'world', 'really?')).toBe(false)
    expect(notes[PATH]).toBe(HOLD)
  })

  it('sends nothing for a blank message, or a run with no hold note', async () => {
    const actions = makeActions()
    expect(await actions.chat(RUN, 'world', '  \n ')).toBe(false)
    expect(await actions.chat('2026-09-15-none', 'world', 'really?')).toBe(false)
    expect(requests).toEqual([])
  })
})

describe('revise', () => {
  const turn = { name: 'world', message: 'why a test?', reply: 'Someone is watching.' }

  it('reruns downstream with the reply as that proposal’s output', async () => {
    rerunFrames = [{ type: 'run_start', runId: NEW }, { type: 'run_complete', runId: NEW }]
    await makeActions().revise(RUN, turn)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.branchedFromRunId).toBe(RUN)
    expect(requests[0]?.branchOutputs).toContainEqual(output('world', 'Someone is watching.'))
  })

  it('says which run the hold now lives under, and marks that reply revised as it', async () => {
    rerunFrames = [{ type: 'run_start', runId: NEW }, { type: 'run_complete', runId: NEW }]
    const actions = makeActions()
    expect(await actions.revise(RUN, turn)).toBe(NEW)
    const conversation = (await actions.read(NEW))?.conversation
    expect(conversation?.[0]).toMatchObject({ revisedAs: '2026-09-14-old' })
    expect(conversation?.at(-1)).toEqual({ kind: 'chat', ...turn, revisedAs: NEW })
    expect(Object.keys(notes)).toEqual([NEW_PATH])
  })

  it('leaves the hold where it was when the rerun fails', async () => {
    rerunFrames = [{ type: 'run_start', runId: NEW }, { type: 'error', error: 'the chain broke' }]
    expect(await makeActions().revise(RUN, turn)).toBeUndefined()
    expect(notes[PATH]).toBe(HOLD)
    expect(notices).toEqual([`Rerun ${NEW} failed: the chain broke`])
  })
})

describe('askRoom', () => {
  it('asks every proposer, and writes the question with their answers at the end of the Conversation', async () => {
    framesByAgent = { gameplay: answer('gameplay', 'Rotation is the hook.'), world: answer('world', 'The watcher is.') }
    const actions = makeActions()
    expect(await actions.askRoom(RUN, 'what is the hook?')).toBe(true)
    expect(requests.map(request => request.agentName)).toEqual(['gameplay', 'world'])
    expect(notes[PATH]).toBe(`${HOLD}\nask the room: what is the hook?\n> **gameplay:**\n> Rotation is the hook.\n> **world:**\n> The watcher is.\n`)
    expect((await actions.read(RUN))?.conversation.at(-1)).toEqual({
      kind: 'room',
      question: 'what is the hook?',
      answers: [
        { name: 'gameplay', answer: 'Rotation is the hook.' },
        { name: 'world', answer: 'The watcher is.' },
      ],
    })
  })

  it('writes nothing, and says so, when nobody answered', async () => {
    framesByAgent = { gameplay: [{ type: 'error', error: 'refused' }], world: [{ type: 'error', error: 'refused' }] }
    expect(await makeActions().askRoom(RUN, 'what is the hook?')).toBe(false)
    expect(notes[PATH]).toBe(HOLD)
    expect(notices).toEqual([NOBODY_ANSWERED])
  })

  it('asks nothing for a blank question', async () => {
    expect(await makeActions().askRoom(RUN, ' ')).toBe(false)
    expect(requests).toEqual([])
  })
})

describe('change', () => {
  it('writes a CHANGE line at the end of the Direction', async () => {
    const actions = makeActions()
    expect(await actions.change(RUN, 'rotation should\nhurt')).toBe(true)
    expect((await actions.read(RUN))?.direction.at(-1)).toBe('CHANGE: rotation should hurt')
  })

  it('writes nothing for a blank change', async () => {
    expect(await makeActions().change(RUN, '  ')).toBe(false)
    expect(notes[PATH]).toBe(HOLD)
  })
})

describe('writeHold', () => {
  it('writes the hold for a run', async () => {
    await makeActions().writeHold('2026-09-15-none')
    expect(written).toEqual(['2026-09-15-none'])
  })
})

describe('openInTab', () => {
  it('opens the run’s hold note in a tab', async () => {
    await makeActions().openInTab(RUN)
    expect(openedInTab).toEqual([PATH])
  })

  it('opens nothing for a run with no hold note', async () => {
    await makeActions().openInTab('2026-09-15-none')
    expect(openedInTab).toEqual([])
  })
})

describe('onChange', () => {
  it('tells a listener when the run’s hold note is written, and not for any other note', () => {
    const heard: string[] = []
    makeActions().onChange(RUN, () => void heard.push('changed'))
    touch('modify', PATH)
    touch('create', PATH)
    touch('modify', 'Maestro/holds/2026-09-15-other.md')
    expect(heard).toEqual(['changed', 'changed'])
  })

  it('stops telling it once it stops listening', () => {
    const heard: string[] = []
    const stop = makeActions().onChange(RUN, () => void heard.push('changed'))
    stop()
    touch('modify', PATH)
    expect(heard).toEqual([])
  })
})
