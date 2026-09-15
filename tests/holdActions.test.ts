import { describe, it, expect, beforeEach } from 'vitest'
import { HoldActions, PROPOSAL_HEADING } from '@/ui/holdActions'
import { HoldNotes } from '@/ui/holdNotes'
import { AskTheRoom, NOBODY_ANSWERED } from '@/ui/askTheRoom'
import { ChatWithProposer } from '@/ui/chatWithProposer'
import { NO_EDITED_PROPOSAL, RerunDownstream } from '@/ui/rerunDownstream'
import { EngineOfflineError } from '@/engine/transport'
import { RunPanels } from '@/ui/runPanels'
import { Resume } from '@/ui/resume'
import { SideQuest } from '@/ui/sideQuest'
import type { EngineClient } from '@/engine/client'
import type { AgentOutput, LayoutModel, LayoutPanel, RunEvent, RunMeta, RunRequest } from '@/engine/types'
import type { App, TAbstractFile, TFile } from 'obsidian'
import { TFile as StubFile, TFolder } from './obsidian'

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

const panel = (name: string, text: string, emphasis?: 'join'): LayoutPanel => ({
  name,
  node: name,
  text,
  lines: 1,
  state: 'filled',
  ...(emphasis ? { emphasis } : {}),
})

const output = (nodeId: string, text: string): AgentOutput => ({ nodeId, agentName: nodeId, output: text, status: 'success', timestamp: '' })

/** A human's words replayed in place of a node's output: nothing ran, so nothing was spent. */
const revision = (nodeId: string, text: string): AgentOutput => ({ ...output(nodeId, text), tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0 })

const GAMEPLAY = '## Core verb\nRotate abilities mid-fight.\n\n## Proposed canon\n- LOCKED: Abilities rotate randomly during active combat.'
const WORLD = '## The rule\nThe world is a test — and someone is watching.\n\n## Proposed canon\n- LOCKED: The world is a controlled testing environment.'

/** What the run wrote: each proposal as the hold note shows it, unedited. */
const panels = [
  panel('gameplay', GAMEPLAY),
  panel('world', WORLD),
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

const QUEST = '2026-09-16-quest1'
const RESUMED = '2026-09-16-pitch1'
const ENGINE_URL = 'http://localhost:4000'

const questRun: RunMeta = {
  runId: QUEST,
  chainName: 'combat lab',
  seedPrompt: '',
  startedAt: '',
  status: 'complete',
  agentOutputs: [output('sparring', 'A first pass.'), output('combat-report', 'Rotation lands as a rhythm.\n\nKeep it.')],
}

const resumedRun: RunMeta = {
  runId: RESUMED,
  chainName: 'develop-direction',
  seedPrompt: '',
  startedAt: '',
  status: 'complete',
  agentOutputs: [output('greenlight', '## Risks\nToo much Nier.\n\n## Greenlight Pitch\nA combat trial in a void.')],
}

let notes: Record<string, string>
let notices: string[]
let listeners: { name: string; callback: (file: TAbstractFile) => void; removed: boolean }[]
let written: string[]
let openedInTab: string[]
let framesByAgent: Record<string, RunEvent[]>
let rerunFrames: RunEvent[]
let chainFrames: RunEvent[]
let requests: RunRequest[]
let online: boolean
let layoutsFetched: number
let folders: string[]

function file(path: string): TFile {
  const stub = new StubFile()
  stub.path = path
  return stub as unknown as TFile
}

function makeActions(): HoldActions {
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => {
        if (notes[path] !== undefined) return file(path)
        return folders.includes(path) ? Object.assign(new TFolder(), { path }) : null
      },
      create: (path: string, content: string) => Promise.resolve(void (notes[path] = content)),
      createFolder: (path: string) => Promise.resolve(void folders.push(path)),
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
    getRun: (runId: string) => {
      if (runId === QUEST) return Promise.resolve(questRun)
      return Promise.resolve(runId === RESUMED ? resumedRun : theRun(runId))
    },
    listChains: () =>
      online
        ? Promise.resolve([{ slug: 'combat-lab', name: 'combat lab' }, { slug: 'develop', name: 'develop-direction' }])
        : Promise.reject(new EngineOfflineError(ENGINE_URL)),
    getLayout: (): Promise<LayoutModel> => {
      if (!online) return Promise.reject(new EngineOfflineError('http://localhost:3000'))
      layoutsFetched++
      return Promise.resolve({ kind: 'columns', panels })
    },
    launchRun: async function* (request: RunRequest) {
      requests.push(request)
      if (request.branchedFromRunId) yield* rerunFrames
      else if (request.agentName) yield* framesByAgent[request.agentName] ?? []
      else yield* chainFrames
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
    rerun: new RerunDownstream({ app, engine, withEngine, notify }),
    quest: new SideQuest({ app, engine, withEngine, notify, engineUrl: () => ENGINE_URL }),
    resume: new Resume({ app, engine, withEngine, notify, engineUrl: () => ENGINE_URL }),
    engineUrl: () => ENGINE_URL,
    panels: new RunPanels(engine),
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
  chainFrames = []
  requests = []
  online = true
  layoutsFetched = 0
  folders = []
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

describe('read, edited proposals', () => {
  it('marks no proposal edited while each reads as its run wrote it', async () => {
    const hold = await makeActions().read(RUN)
    expect(hold?.proposals.map(proposal => proposal.edited)).toEqual([false, false])
  })

  it('marks a proposal whose words differ from what its run wrote', async () => {
    notes[PATH] = HOLD.replace('Rotate abilities mid-fight.', 'Rotate stances.')
    const hold = await makeActions().read(RUN)
    expect(hold?.proposals.map(proposal => proposal.edited)).toEqual([true, false])
  })

  it('marks none edited while the engine cannot say what the run wrote', async () => {
    online = false
    notes[PATH] = HOLD.replace('Rotate abilities mid-fight.', 'Rotate stances.')
    const hold = await makeActions().read(RUN)
    expect(hold?.proposals.map(proposal => proposal.edited)).toEqual([false, false])
  })

  it('asks the engine what a run wrote once, however often the hold is read', async () => {
    const actions = makeActions()
    await actions.read(RUN)
    await actions.read(RUN)
    expect(layoutsFetched).toBe(1)
  })

  it('asks again once the engine could not say', async () => {
    const actions = makeActions()
    online = false
    await actions.read(RUN)
    online = true
    notes[PATH] = HOLD.replace('Rotate abilities mid-fight.', 'Rotate stances.')
    expect((await actions.read(RUN))?.proposals[0]?.edited).toBe(true)
  })
})

describe('editProposal', () => {
  it('writes the new words in place of the proposal’s, keeping its thinking', async () => {
    expect(await makeActions().editProposal(RUN, 'gameplay', '## Core verb\nRotate stances.\n')).toBe(true)
    expect(notes[PATH]).toBe(HOLD.replace(GAMEPLAY, '## Core verb\nRotate stances.'))
  })

  it('edits the last proposal without touching the Direction after it', async () => {
    await makeActions().editProposal(RUN, 'world', 'The world is real.')
    expect(notes[PATH]).toBe(HOLD.replace(WORLD, 'The world is real.'))
  })

  it('reads the edit back, marked edited', async () => {
    const actions = makeActions()
    await actions.editProposal(RUN, 'world', 'The world is real.')
    expect((await actions.read(RUN))?.proposals[1]).toMatchObject({ text: 'The world is real.', edited: true })
  })

  it('writes nothing, and says why, for words with a line the note would read as the next proposal', async () => {
    const actions = makeActions()
    expect(await actions.editProposal(RUN, 'world', 'The world.\n### Another\nMore.')).toBe(false)
    expect(notes[PATH]).toBe(HOLD)
    expect(notices).toEqual([PROPOSAL_HEADING])
  })

  it('writes nothing for blank words, or a proposal the hold does not have', async () => {
    const actions = makeActions()
    expect(await actions.editProposal(RUN, 'world', ' \n ')).toBe(false)
    expect(await actions.editProposal(RUN, 'nobody', 'Words.')).toBe(false)
    expect(notes[PATH]).toBe(HOLD)
  })
})

describe('rerun', () => {
  beforeEach(() => {
    rerunFrames = [{ type: 'run_start', runId: NEW }, { type: 'run_complete', runId: NEW }]
  })

  it('reruns downstream from the hold’s run, each edited proposal’s words as its output', async () => {
    const actions = makeActions()
    await actions.editProposal(RUN, 'world', 'The world is real.')
    await actions.rerun(RUN)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.branchedFromRunId).toBe(RUN)
    expect(requests[0]?.branchOutputs).toContainEqual(revision('world', 'The world is real.'))
    expect(requests[0]?.branchOutputs).toContainEqual(output('gameplay', '## Core verb\nRotate abilities mid-fight.'))
  })

  it('answers the run the hold now lives under', async () => {
    const actions = makeActions()
    await actions.editProposal(RUN, 'world', 'The world is real.')
    expect(await actions.rerun(RUN)).toBe(NEW)
    expect(Object.keys(notes)).toEqual([NEW_PATH])
  })

  it('runs nothing, and says why, when no proposal is edited', async () => {
    expect(await makeActions().rerun(RUN)).toBeUndefined()
    expect(requests).toEqual([])
    expect(notices).toEqual([NO_EDITED_PROPOSAL])
  })

  it('leaves the hold where it was when the rerun fails', async () => {
    rerunFrames = [{ type: 'run_start', runId: NEW }, { type: 'error', error: 'the chain broke' }]
    const actions = makeActions()
    await actions.editProposal(RUN, 'world', 'The world is real.')
    expect(await actions.rerun(RUN)).toBeUndefined()
    expect(Object.keys(notes)).toEqual([PATH])
    expect(notices).toEqual([`Rerun ${NEW} failed: the chain broke`])
  })

  it('runs nothing for a run with no hold note', async () => {
    expect(await makeActions().rerun('2026-09-15-none')).toBeUndefined()
    expect(requests).toEqual([])
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
      { kind: 'quest', name: 'world', chainName: 'combat-lab', runId: '2026-09-14-quest', result: 'The test becomes an arena.\n\nEvery fight is graded.' },
      { kind: 'chat', name: 'world', message: 'why a test?', reply: 'Someone is watching.' },
    ])
  })

  it('reads a side quest typed into the note that has no result yet', async () => {
    notes[PATH] = HOLD + 'side quest: @gameplay combat-lab\n'
    expect((await makeActions().read(RUN))?.conversation.at(-1)).toEqual({ kind: 'quest', name: 'gameplay', chainName: 'combat-lab' })
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
    expect(requests[0]?.branchOutputs).toContainEqual(revision('world', 'Someone is watching.'))
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

  it('keeps each answer whole, and reads it back whole', async () => {
    const long = '## Short answer\nA bit.\n\n**Verdict:** keep it.\n\n## Why\nThe halo reads as a pod.\n## What I would change\nTie it to the stance.'
    framesByAgent = { gameplay: answer('gameplay', long), world: answer('world', 'No.') }
    const actions = makeActions()
    await actions.askRoom(RUN, 'too much?')
    expect((await actions.read(RUN))?.conversation.at(-1)).toEqual({
      kind: 'room',
      question: 'too much?',
      answers: [
        { name: 'gameplay', answer: long },
        { name: 'world', answer: 'No.' },
      ],
    })
  })

  it('does not take a bold line inside an answer for the next proposal', async () => {
    framesByAgent = { gameplay: answer('gameplay', '**Short answer:**\nA bit.'), world: answer('world', 'No.') }
    const actions = makeActions()
    await actions.askRoom(RUN, 'too much?')
    const room = (await actions.read(RUN))?.conversation.at(-1)
    expect(room?.kind === 'room' && room.answers.map(one => one.name)).toEqual(['gameplay', 'world'])
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

describe('sideQuest', () => {
  beforeEach(() => {
    chainFrames = [{ type: 'run_start', runId: QUEST }, { type: 'run_complete', runId: QUEST }]
  })

  it('runs the chain on the proposal alone, as the hold has it', async () => {
    await makeActions().sideQuest(RUN, 'gameplay', 'combat lab')
    expect(requests).toEqual([{ chainName: 'combat lab', seedPrompt: GAMEPLAY }])
  })

  it('sends a proposal’s edit rather than what its run wrote', async () => {
    const actions = makeActions()
    await actions.editProposal(RUN, 'world', 'The world is real.')
    await actions.sideQuest(RUN, 'world', 'combat lab')
    expect(requests[0]?.seedPrompt).toBe('The world is real.')
  })

  it('writes the quest, its run and its result at the end of the Conversation, where the read finds them', async () => {
    const actions = makeActions()
    expect(await actions.sideQuest(RUN, 'gameplay', 'combat lab')).toBe(true)
    expect(notes[PATH]).toBe(
      `${HOLD}\nside quest: @gameplay combat lab\n> → [run ${QUEST}](${ENGINE_URL}/history/${QUEST})\n> Rotation lands as a rhythm.\n> \n> Keep it.\n`,
    )
    expect((await actions.read(RUN))?.conversation.at(-1)).toEqual({
      kind: 'quest',
      name: 'gameplay',
      chainName: 'combat lab',
      runId: QUEST,
      result: 'Rotation lands as a rhythm.\n\nKeep it.',
    })
  })

  it('writes nothing, and says why, when the run failed', async () => {
    chainFrames = [{ type: 'run_start', runId: QUEST }, { type: 'error', error: 'the model refused' }]
    expect(await makeActions().sideQuest(RUN, 'gameplay', 'combat lab')).toBe(false)
    expect(notes[PATH]).toBe(HOLD)
    expect(notices).toEqual([`Side quest run ${QUEST} failed: the model refused`])
  })

  it('writes nothing when the engine is offline', async () => {
    online = false
    expect(await makeActions().sideQuest(RUN, 'gameplay', 'combat lab')).toBe(false)
    expect(notes[PATH]).toBe(HOLD)
  })

  it('sends nothing for a blank chain, a proposal the hold does not have, or a run with no hold note', async () => {
    const actions = makeActions()
    expect(await actions.sideQuest(RUN, 'gameplay', '  ')).toBe(false)
    expect(await actions.sideQuest(RUN, 'nobody', 'combat lab')).toBe(false)
    expect(await actions.sideQuest('2026-09-15-none', 'gameplay', 'combat lab')).toBe(false)
    expect(requests).toEqual([])
  })
})

describe('chains', () => {
  it('names the chains on the engine', async () => {
    expect(await makeActions().chains()).toEqual(['combat lab', 'develop-direction'])
  })

  it('names none, and says nothing, while the engine is offline', async () => {
    online = false
    expect(await makeActions().chains()).toEqual([])
    expect(notices).toEqual([])
  })
})

describe('runUrl', () => {
  it('links a run on the engine as it is set now', () => {
    expect(makeActions().runUrl(QUEST)).toBe(`${ENGINE_URL}/history/${QUEST}`)
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

describe('resume', () => {
  const started = (runId: string): RunEvent[] => [{ type: 'run_start', runId }]

  beforeEach(() => {
    chainFrames = started(RESUMED)
  })

  it('sends the Direction block through develop-direction, with canon as its context', async () => {
    notes['context/canon-anime-game.md'] = '## LOCKED\n- an older commitment\n'
    await makeActions().resume(RUN)
    expect(requests).toEqual([
      {
        chainName: 'develop-direction',
        seedPrompt: expect.stringContaining('KEEP: gameplay') as string,
        context: { 'canon-anime-game': '## LOCKED\n- an older commitment\n' },
      },
    ])
  })

  it('brings back the Greenlight Pitch, not the whole output, with the run it landed on', async () => {
    expect(await makeActions().resume(RUN)).toMatchObject({ runId: RESUMED, pitch: 'A combat trial in a void.' })
  })

  it('locks the hold’s ticked canon lines, and only those', async () => {
    expect(await makeActions().resume(RUN)).toMatchObject({ canon: 'written' })
    const canon = notes['context/canon-anime-game.md']
    expect(canon).toContain('- Abilities rotate randomly during active combat.')
    expect(canon).not.toContain('someone is watching')
  })

  it('links the run in the hold note', async () => {
    await makeActions().resume(RUN)
    expect(notes[PATH]).toContain(`## Resumed`)
    expect(notes[PATH]).toContain(RESUMED)
  })

  it('reports a failed run, holds its canon back, and asks for no pitch', async () => {
    chainFrames = [...started(RESUMED), { type: 'error', error: 'the model refused' }]
    const result = await makeActions().resume(RUN)
    expect(result).toMatchObject({ runId: RESUMED, error: 'the model refused', canon: 'held-back' })
    expect(result?.pitch).toBeUndefined()
    expect(notes['context/canon-anime-game.md']).toBeUndefined()
  })

  it('has nothing to report for a run with no hold note', async () => {
    expect(await makeActions().resume('2026-09-15-nothing')).toBeUndefined()
    expect(requests).toEqual([])
  })

  it('has nothing to report while the engine is offline', async () => {
    online = false
    expect(await makeActions().resume(RUN)).toBeUndefined()
  })
})
