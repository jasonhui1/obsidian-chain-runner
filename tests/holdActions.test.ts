import { describe, it, expect, beforeEach } from 'vitest'
import { HoldActions } from '@/ui/holdActions'
import { HoldNotes } from '@/ui/holdNotes'
import type { App, TAbstractFile, TFile } from 'obsidian'
import { TFile as StubFile } from './obsidian'

/**
 * The hold-actions layer the directing panel talks to: what it reads out of a
 * hold note, and what its two actions leave on disk. The fixture is shaped like
 * a real hold — proposals with headings of their own, a thinking fold, a
 * Direction already part-written and ticked.
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
`

let notes: Record<string, string>
let notices: string[]
let listeners: { name: string; callback: (file: TAbstractFile) => void; removed: boolean }[]
let written: string[]
let openedInTab: string[]

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
      on: (name: string, callback: (file: TAbstractFile) => void) => {
        const listener = { name, callback, removed: false }
        listeners.push(listener)
        return listener
      },
      offref: (ref: { removed: boolean }) => void (ref.removed = true),
    },
    workspace: {
      getLeaf: () => ({ openFile: (target: { path: string }) => Promise.resolve(void openedInTab.push(target.path)) }),
    },
  } as unknown as App
  const notify = (message: string): void => void notices.push(message)
  return new HoldActions({
    app,
    notify,
    notes: new HoldNotes({ app, notify }),
    write: runId => Promise.resolve(void written.push(runId)),
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
