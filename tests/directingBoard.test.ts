// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { DirectingBoard, type MenuItem } from '@/ui/directingBoard'
import { ALREADY_GOING, Holds, type Hold } from '@/ui/holds'
import type { ProposalEditor } from '@/ui/proposalEditor'
import { RerunWatch } from '@/run/rerunWatch'
import type { ChatEvent, RunEvent, RunMeta, RunRequest } from '@/engine/types'
import { answer, layoutFrame, output, panel, started } from './engineFrames'
import { MemoryNoteStore } from './memoryNoteStore'
import { stubEngine } from './stubEngine'

/**
 * The directing panel at its interface: which tab shows what, what each button
 * leaves in the hold note through the hold module, and that the panel follows
 * the hold as the note changes and as a rerun or resume lands it elsewhere.
 * What a hold reads as is `holds.test.ts`.
 */

const RUN = '2026-09-15-ubqPU2'
const PATH = `Maestro/holds/${RUN}.md`
const NEW = '2026-09-16-Xy9zW2'
const RESUMED = '2026-09-16-Rs1Kq4'
const NONE = '2026-09-15-none'
const QUEST = '2026-09-16-quest3'

const NOTE = `# Hold: run ${RUN} · creative-director

## Verdict (creative-director)

A combat trial in a void.

## Proposals
### gameplay

Rotate abilities mid-fight.

### world

A controlled test.

## Direction
KEEP: gameplay
CHANGE:
KILL:
COMBINE:
PUSH:

CANON?
- [x] LOCKED: Abilities rotate. — gameplay
- [ ] LOCKED: A test. — world

## Conversation
`

/** The note with `text` written into its Conversation. */
const talking = (text: string): string => `${NOTE}\n${text}\n`

/** The note with gameplay's words edited since the run. */
const EDITED = NOTE.replace('Rotate abilities mid-fight.', 'Rotate stances.')

/** The hold as `NOTE` reads, which a test can change to draw what the note does not say. */
const hold = (over: Partial<Hold> = {}): Hold => ({
  runId: RUN,
  earlierRuns: [],
  chainName: 'creative-director',
  verdict: 'A combat trial in a void.',
  proposals: [
    { name: 'gameplay', text: 'Rotate abilities mid-fight.', given: ['KEEP'], combinedWith: [], edited: false },
    { name: 'world', text: 'A controlled test.', given: [], combinedWith: [], edited: false },
  ],
  direction: ['KEEP: gameplay'],
  canon: [
    { id: 'LOCKED: Abilities rotate. — gameplay', text: 'LOCKED: Abilities rotate.', proposer: 'gameplay', ticked: true },
    { id: 'LOCKED: A test. — world', text: 'LOCKED: A test.', proposer: 'world', ticked: false },
  ],
  conversation: [],
  holds: [],
  ...over,
})

/** What the run wrote, as the note shows it. */
const PANELS = [panel('gameplay', 'Rotate abilities mid-fight.'), panel('world', 'A controlled test.'), panel('creative-director', 'A combat trial in a void.', 'join')]

const theRun = (runId: string): RunMeta => ({
  runId,
  chainName: 'creative-director',
  seedPrompt: 'a combat trial',
  startedAt: '',
  status: 'complete',
  agentOutputs: [output('gameplay', 'Rotate abilities mid-fight.'), output('world', 'A controlled test.'), output('creative-director', 'A combat trial in a void.')],
  graph: {
    edges: [
      { fromNode: 'gameplay', toNode: 'creative-director' },
      { fromNode: 'world', toNode: 'creative-director' },
    ],
  },
})

const complete = (runId: string): RunEvent => ({ type: 'run_complete', runId })
/** The frame a rerun of this hold sends, the named panels still waiting. */
const waitingOn = (...waiting: string[]): RunEvent => layoutFrame(PANELS, ...waiting)
const stepOn = (nodeId: string, agentName = nodeId): RunEvent => ({ type: 'agent_start', agentName, nodeId, step: 0 })

/** A stream the test feeds a frame at a time, and ends. */
class Feed<T> {
  private readonly queue: T[] = []
  private done = false
  private wake: () => void = () => {}

  push(...frames: T[]): void {
    this.queue.push(...frames)
    this.wake()
  }

  end(...frames: T[]): void {
    this.done = true
    this.push(...frames)
  }

  async *frames(): AsyncGenerator<T> {
    for (;;) {
      const next = this.queue.shift()
      if (next !== undefined) yield next
      else if (this.done) return
      else await new Promise<void>(resolve => (this.wake = resolve))
    }
  }
}

let root: HTMLElement
let store: MemoryNoteStore
let notes: Record<string, string>
let holds: Holds
let notices: string[]
let online: boolean
let released: number
let overflowing: boolean
let chainNames: string[]
let chainsAsked: number
let menus: MenuItem[][]
/** Every editor the board has opened, in the order it opened them. */
let editors: FakeEditor[]
let clock: number
let reruns: RerunWatch
/** The board's running timers, ticked by the test. */
let timers: Set<() => void>
/** Holds every streaming call until the test lets it go. */
let gate: Promise<void> | undefined
let release: () => void
/** Feeds the one streaming call a test watches frame by frame, in place of the frames below. */
let feed: Feed<RunEvent> | undefined
let requests: RunRequest[]
let resumed: string[]
let promoted: { nodeId: string; turn: number }[]
let chats: string[]
let framesByAgent: Record<string, RunEvent[]>
let rerunFrames: RunEvent[]
let resumeFrames: RunEvent[]
let chatFrames: ChatEvent[]

/** Stands in for the CodeMirror editor: a textarea, so a test can type into it. */
interface FakeEditor extends ProposalEditor {
  el: HTMLTextAreaElement
  destroyed: boolean
}

const openEditor = (words: string, changed: () => void): FakeEditor => {
  const el = document.createElement('textarea')
  el.value = words
  el.addEventListener('input', changed)
  const editor: FakeEditor = {
    el,
    destroyed: false,
    text: () => el.value,
    destroy: () => void (editor.destroyed = true),
  }
  editors.push(editor)
  return editor
}

async function* stream<T>(frames: () => T[]): AsyncGenerator<T> {
  if (feed) {
    yield* feed.frames() as AsyncGenerator<T>
    return
  }
  await gate
  yield* frames()
}

function makeHolds(): Holds {
  const engine = stubEngine({
    capabilities: () => Promise.resolve({}),
    getRun: (runId: string) => Promise.resolve(theRun(runId)),
    getLayout: () => Promise.resolve({ kind: 'columns', panels: PANELS }),
    waitingRun: () => Promise.resolve(undefined),
    launchRun: (request: RunRequest) => {
      requests.push(request)
      if (request.branchedFromRunId) return stream(() => rerunFrames)
      if (request.agentName) return stream(() => framesByAgent[request.agentName!] ?? [])
      return stream(() => [...started(QUEST), complete(QUEST)])
    },
    resumeRun: (runId: string) => {
      resumed.push(runId)
      return stream(() => resumeFrames)
    },
    promoteNode: (node: { nodeId: string }, request: { turn: number }) => {
      promoted.push({ nodeId: node.nodeId, turn: request.turn })
      return stream(() => rerunFrames)
    },
    chatWithNode: (chat: { nodeId: string; message: string }) => {
      chats.push(`${chat.nodeId} ${chat.message}`)
      return stream(() => chatFrames)
    },
  })
  return new Holds({
    store,
    engine,
    withEngine: async action => (online ? action() : undefined),
    notify: message => void notices.push(message),
    reruns,
    runUrl: runId => `http://engine/history/${runId}`,
  })
}

function board(): DirectingBoard {
  return new DirectingBoard(root, {
    holds,
    reruns,
    chains: () => {
      chainsAsked++
      return Promise.resolve(chainNames)
    },
    runUrl: runId => `http://engine/history/${runId}`,
    renderMarkdown: (text, into) => {
      into.append(document.createTextNode(text))
      return () => void released++
    },
    openEditor,
    openMenu: (_event, items) => void menus.push(items),
    clock: {
      every: (_ms, tick) => {
        timers.add(tick)
        return () => void timers.delete(tick)
      },
    },
    watchOverflow: (_frame, changed) => {
      changed(overflowing)
      return () => {}
    },
  })
}

/** A board showing `reading` of the run, as a card click hands it over. */
function open(reading: Hold | undefined = hold(), proposal?: string): DirectingBoard {
  const made = board()
  made.show(reading?.runId ?? RUN, reading, proposal)
  return made
}

/** A board showing the hold as the note now reads. */
async function openNote(proposal?: string): Promise<DirectingBoard> {
  return open(await holds.read(RUN), proposal)
}

/** Lets the board's awaited answers land. */
const settled = (): Promise<void> => new Promise(resolve => setTimeout(resolve))

/** The note touched by another hand, which the panel draws again. */
const touched = async (): Promise<void> => {
  await store.process(PATH, content => content)
  await settled()
}

/** Holds every streaming call until `release`. */
const holdEngine = (): void => void (gate = new Promise(resolve => (release = resolve)))

const buttons = (): HTMLButtonElement[] => Array.from(root.querySelectorAll('button'))
const button = (text: string): HTMLButtonElement => {
  const found = buttons().find(candidate => candidate.textContent === text)
  if (!found) throw new Error(`no "${text}" button among ${buttons().map(b => b.textContent).join(', ')}`)
  return found
}
const has = (text: string): boolean => buttons().some(b => b.textContent === text)
const tabs = (): string[] => Array.from(root.querySelectorAll('[role="tab"]')).map(tab => tab.textContent ?? '')
const selectedTab = (): string | null | undefined => root.querySelector('[role="tab"][aria-selected="true"]')?.textContent
const boxes = (): HTMLInputElement[] => Array.from(root.querySelectorAll('input[type="checkbox"]'))
const text = (): string => root.textContent ?? ''
const header = (): string => root.querySelector('.chain-runner-directing-header')?.textContent ?? ''
const turns = (): string[] => Array.from(root.querySelectorAll('.chain-runner-directing-turn')).map(turn => turn.textContent ?? '')
const composer = (placeholder: string): HTMLTextAreaElement => {
  const found = Array.from(root.querySelectorAll('textarea')).find(box => box.placeholder === placeholder)
  if (!found) throw new Error(`no "${placeholder}" box`)
  return found
}
const type = (box: HTMLTextAreaElement, words: string): void => {
  box.value = words
  box.dispatchEvent(new Event('input'))
}
const press = (box: HTMLElement, key: string, shiftKey = false): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, shiftKey, cancelable: true })
  box.dispatchEvent(event)
  return event
}
const direction = async (): Promise<string[] | undefined> => (await holds.read(RUN))?.direction

beforeEach(() => {
  document.body.replaceChildren()
  root = document.createElement('div')
  document.body.append(root)
  store = new MemoryNoteStore({ [PATH]: NOTE })
  notes = store.notes
  notices = []
  online = true
  released = 0
  overflowing = false
  chainNames = []
  chainsAsked = 0
  menus = []
  editors = []
  clock = 0
  timers = new Set()
  gate = undefined
  release = () => {}
  feed = undefined
  requests = []
  resumed = []
  promoted = []
  chats = []
  framesByAgent = {}
  rerunFrames = [...started(NEW), complete(NEW)]
  resumeFrames = [...started(RUN), complete(RUN)]
  chatFrames = [{ type: 'chat_done', message: { role: 'assistant', content: 'Because it is.' } }]
  reruns = new RerunWatch(() => clock)
  holds = makeHolds()
})

it('draws the hold the note reads as, which every other test draws by hand', async () => {
  expect(await holds.read(RUN)).toEqual(hold())
})

describe('header', () => {
  it('names the chain and the run’s short id', () => {
    open()
    expect(header()).toContain('creative-director')
    expect(header()).toContain('ubqPU2')
  })

  it('offers the hold note in a tab from the ⋯ menu', async () => {
    open()
    root.querySelector<HTMLButtonElement>('[aria-label="More"]')?.click()
    menus[0]![0]!.click()
    await settled()
    expect(store.opened).toEqual([PATH])
  })
})

describe('tabs', () => {
  it('has Run, then one tab per proposal', () => {
    open()
    expect(tabs()).toEqual(['Run', 'gameplay', 'world'])
  })

  it('opens on the Run tab when no proposal is named', () => {
    open()
    expect(selectedTab()).toBe('Run')
  })

  it('opens on the proposal a card named', () => {
    open(hold(), 'world')
    expect(selectedTab()).toBe('world')
  })

  it('falls back to Run for a proposal the hold does not have', () => {
    open(hold(), 'nobody')
    expect(selectedTab()).toBe('Run')
  })

  it('switches on a click, and keeps the tab when the note changes', async () => {
    open()
    button('gameplay').click()
    expect(selectedTab()).toBe('gameplay')
    await touched()
    expect(selectedTab()).toBe('gameplay')
  })

  it('renders again only the markdown whose words changed, releasing what it replaces', async () => {
    open()
    await touched()
    expect(released).toBe(0)
    notes[PATH] = NOTE.replace('A combat trial in a void.', 'A quiet shrine.')
    await touched()
    expect(released).toBe(1)
  })

  it('shows the top of a tab it switches to', () => {
    open()
    root.querySelector<HTMLElement>('.chain-runner-directing-body')!.scrollTop = 200
    button('world').click()
    expect(root.querySelector<HTMLElement>('.chain-runner-directing-body')!.scrollTop).toBe(0)
  })
})

describe('following the note', () => {
  it('draws the note again when it is edited by hand', async () => {
    open()
    notes[PATH] = NOTE.replace('A combat trial in a void.', 'A quiet shrine.')
    await touched()
    expect(text()).toContain('A quiet shrine.')
  })

  it('draws a change heard while the reader switches tab', async () => {
    open()
    notes[PATH] = NOTE.replace('A controlled test.', 'A real world.')
    void store.process(PATH, content => content)
    button('world').click()
    await settled()
    expect(text()).toContain('A real world.')
  })

  it('stops hearing the note once the panel goes away', async () => {
    open().close()
    notes[PATH] = NOTE.replace('A combat trial in a void.', 'A quiet shrine.')
    await touched()
    expect(text()).not.toContain('A quiet shrine.')
  })

  it('hears only the run it shows', async () => {
    const made = open()
    made.show(NONE, undefined)
    await touched()
    expect(text()).toContain(`Run ${NONE} has no hold note yet.`)
  })
})

describe('a proposal tab', () => {
  it('has a button for each verb but COMBINE, those already given marked', () => {
    open(hold(), 'gameplay')
    const verbs = Array.from(root.querySelectorAll<HTMLButtonElement>('.chain-runner-directing-verbs button'))
    expect(verbs.map(verb => verb.textContent)).toEqual(['KEEP', 'KILL', 'PUSH', 'REDUCE', 'MUTATE'])
    expect(verbs.filter(verb => verb.getAttribute('aria-pressed') === 'true').map(verb => verb.textContent)).toEqual(['KEEP'])
  })

  it('directs this proposal with a verb, and draws it given', async () => {
    open(hold(), 'world')
    button('PUSH').click()
    await settled()
    expect(await direction()).toContain('PUSH: world')
    expect(button('PUSH').getAttribute('aria-pressed')).toBe('true')
  })

  it('takes back a verb already given, rather than giving it twice', async () => {
    open(hold(), 'gameplay')
    button('KEEP').click()
    await settled()
    expect(await direction()).toEqual([])
  })

  it('combines with whichever other proposal is picked', async () => {
    open(hold(), 'gameplay')
    const combine = root.querySelector<HTMLSelectElement>('.chain-runner-directing-verbs select')!
    expect(Array.from(combine.options).map(option => option.value)).toEqual(['', 'world'])
    combine.value = 'world'
    combine.dispatchEvent(new Event('change'))
    await settled()
    expect(await direction()).toContain('COMBINE: gameplay + world')
  })

  it('marks a proposal already combined with, and takes that COMBINE back when picked again', async () => {
    notes[PATH] = NOTE.replace('COMBINE:', 'COMBINE: world + gameplay')
    await openNote('gameplay')
    const combine = root.querySelector<HTMLSelectElement>('.chain-runner-directing-verbs select')!
    expect(combine.options[1]!.textContent).toBe('✓ world')
    combine.value = 'world'
    combine.dispatchEvent(new Event('change'))
    await settled()
    expect(await direction()).toEqual(['KEEP: gameplay'])
  })

  it('shows the proposal’s text', () => {
    open(hold(), 'world')
    expect(text()).toContain('A controlled test.')
  })

  it('offers the whole proposal once its text is cut off, and shows all of it when asked', () => {
    overflowing = true
    open(hold(), 'gameplay')
    expect(root.querySelector('.is-clamped')).not.toBeNull()
    expect(button('Show the whole proposal').hidden).toBe(false)
    button('Show the whole proposal').click()
    expect(root.querySelector('.is-clamped')).toBeNull()
    expect(button('Show less').hidden).toBe(false)
  })

  it('offers nothing when none of the text is cut off', () => {
    open(hold(), 'world')
    expect(button('Show the whole proposal').hidden).toBe(true)
    expect(root.querySelector('.is-overflowing')).toBeNull()
  })

  it('lists only that proposal’s canon lines, and ticks one in the note', async () => {
    open(hold(), 'world')
    expect(boxes()).toHaveLength(1)
    expect(boxes()[0]!.checked).toBe(false)
    boxes()[0]!.click()
    await settled()
    expect(notes[PATH]).toContain('- [x] LOCKED: A test. — world')
    expect(boxes()[0]!.checked).toBe(true)
  })
})

describe('a proposal tab, editing', () => {
  const editor = (): HTMLTextAreaElement | null => root.querySelector('.chain-runner-directing-editor textarea')
  const edit = (): void => button('✎ Edit').click()

  it('turns the proposal’s text into an editor holding its words, with Save and Cancel', () => {
    open(hold(), 'world')
    edit()
    expect(editor()?.value).toBe('A controlled test.')
    expect(buttons().map(b => b.textContent)).toEqual(expect.arrayContaining(['Save', 'Cancel']))
    expect(has('✎ Edit')).toBe(false)
  })

  it('writes the edited words into the note on Save, and closes the editor once they are kept', async () => {
    open(hold(), 'world')
    edit()
    type(editor()!, 'A real world.\n\nWith a second line.')
    button('Save').click()
    expect(button('Save').disabled).toBe(true)
    await settled()
    expect((await holds.read(RUN))?.proposals[1]?.text).toBe('A real world.\n\nWith a second line.')
    expect(editor()).toBeNull()
    expect(editors[0]!.destroyed).toBe(true)
  })

  it('keeps the editor open, with its words, when the note would not take them', async () => {
    store.refuse(PATH)
    open(hold(), 'world')
    edit()
    type(editor()!, 'A real world.')
    button('Save').click()
    await settled()
    expect(editor()?.value).toBe('A real world.')
    expect(button('Save').disabled).toBe(false)
    expect(editors).toHaveLength(1)
    expect(editors[0]!.destroyed).toBe(false)
  })

  it('cannot save blank words', () => {
    open(hold(), 'world')
    edit()
    type(editor()!, ' \n ')
    expect(button('Save').disabled).toBe(true)
    type(editor()!, 'Words.')
    expect(button('Save').disabled).toBe(false)
  })

  it('puts the proposal back as it was on Cancel, letting go of the editor', () => {
    open(hold(), 'world')
    edit()
    type(editor()!, 'A real world.')
    button('Cancel').click()
    expect(editor()).toBeNull()
    expect(editors[0]!.destroyed).toBe(true)
    expect(notes[PATH]).toBe(NOTE)
    edit()
    expect(editor()?.value).toBe('A controlled test.')
  })

  it('keeps the one editor, with its words and the focus, when the note changes', async () => {
    open(hold(), 'world')
    edit()
    type(editor()!, 'half an edit')
    editor()!.focus()
    await touched()
    expect(editors).toHaveLength(1)
    expect(editor()).toBe(editors[0]!.el)
    expect(editor()?.value).toBe('half an edit')
    expect(document.activeElement).toBe(editor())
  })

  it('leaves the editor be when the reader is typing somewhere else', async () => {
    open(hold(), 'world')
    edit()
    composer('Message world…').focus()
    await touched()
    expect(document.activeElement).toBe(composer('Message world…'))
  })

  it('lets go of every open editor when the panel goes away', () => {
    const made = open(hold(), 'world')
    edit()
    made.close()
    expect(editors[0]!.destroyed).toBe(true)
    expect(editor()).toBeNull()
  })
})

describe('rerunning downstream', () => {
  beforeEach(() => void (notes[PATH] = EDITED))

  it('offers no rerun while no proposal is edited', () => {
    open(hold(), 'world')
    expect(has('⟳ Rerun downstream')).toBe(false)
  })

  it('offers a rerun in the tab row once a proposal is edited, marking the edited proposals’ tabs, on any tab', async () => {
    await openNote('world')
    expect(button('⟳ Rerun downstream').parentElement?.className).toBe('chain-runner-directing-tabs')
    const marked = Array.from(root.querySelectorAll('[role="tab"].is-edited')).map(tab => tab.textContent)
    expect(marked).toEqual(['gameplay'])
    button('Run').click()
    expect(button('⟳ Rerun downstream')).toBeDefined()
  })

  it('starts no rerun while an edit is open, so no unsaved words are left behind', async () => {
    notes[PATH] = talking('@world why?\n> [turn 1]\n> \n> Because.').replace('Rotate abilities mid-fight.', 'Rotate stances.')
    await openNote('world')
    button('✎ Edit').click()
    expect(button('⟳ Rerun downstream').disabled).toBe(true)
    expect(button('Use this reply as the revision & rerun').disabled).toBe(true)
    expect(button('⟳ Rerun downstream').title).toBe('Save or cancel the edit first')
    button('Cancel').click()
    expect(button('⟳ Rerun downstream').disabled).toBe(false)
  })

  it('reruns downstream, starts no other rerun until it is done, and follows the hold to the run it landed on', async () => {
    holdEngine()
    await openNote('world')
    button('⟳ Rerun downstream').click()
    expect(button('Rerunning…').disabled).toBe(true)
    expect(button('✎ Edit').disabled).toBe(true)
    button('Rerunning…').click()
    await settled()
    expect(requests.map(request => request.branchedFromRunId)).toEqual([RUN])
    release()
    await settled()
    expect(header()).toContain('Xy9zW2')
    expect(has('Rerunning…')).toBe(false)
    expect(selectedTab()).toBe('world')
    expect(notes[`Maestro/holds/${NEW}.md`]).toBeDefined()
  })

  it('draws the note again under the run it landed on', async () => {
    await openNote()
    button('⟳ Rerun downstream').click()
    await settled()
    notes[`Maestro/holds/${NEW}.md`] = notes[`Maestro/holds/${NEW}.md`]!.replace('A combat trial in a void.', 'A quiet shrine.')
    await store.process(`Maestro/holds/${NEW}.md`, content => content)
    await settled()
    expect(text()).toContain('A quiet shrine.')
  })
})

describe('a rerun going', () => {
  const progress = (): string[] => Array.from(root.querySelectorAll('.chain-runner-directing-progress')).map(line => line.textContent ?? '')
  const stale = (selector: string): boolean | undefined => root.querySelector(selector)?.classList.contains('is-stale')
  const tick = (seconds: number): void => {
    clock += seconds * 1000
    timers.forEach(one => one())
  }
  /** A rerun started from the tab named, and the engine's frames so far. */
  const rerunning = async (proposal?: string, ...frames: RunEvent[]): Promise<void> => {
    feed = new Feed()
    await openNote(proposal)
    button('⟳ Rerun downstream').click()
    await settled()
    feed.push(...started(NEW), ...frames)
    await settled()
  }

  beforeEach(() => void (notes[PATH] = EDITED))

  it('shows the step and a timer over the old verdict, greyed out, on the Run tab', async () => {
    await rerunning(undefined, waitingOn('creative-director'), stepOn('creative-director'))
    tick(42)
    expect(progress()).toEqual(['⟳ Writing a new verdict… 0:42'])
    expect(stale('.chain-runner-directing-verdict')).toBe(true)
    expect(root.querySelector('.chain-runner-directing-verdict')?.textContent).toContain('A combat trial in a void.')
  })

  it('says it is starting, over a verdict not yet greyed, until it knows what it writes again', async () => {
    await rerunning()
    expect(progress()).toEqual(['⟳ Starting the rerun… 0:00'])
    expect(stale('.chain-runner-directing-verdict')).toBe(false)
    feed!.push(waitingOn('creative-director'))
    await settled()
    expect(progress()).toEqual(['⟳ Starting the rerun… 0:00'])
    expect(stale('.chain-runner-directing-verdict')).toBe(true)
  })

  it('names a step that is not the verdict as running', async () => {
    await rerunning(undefined, waitingOn('creative-director'), stepOn('scratch', 'critic'))
    tick(65)
    expect(progress()).toEqual(['⟳ critic is running… 1:05'])
  })

  it('leaves the verdict as it is when the rerun does not write it again', async () => {
    await rerunning(undefined, waitingOn('world'), stepOn('world'))
    expect(progress()).toEqual([])
    expect(stale('.chain-runner-directing-verdict')).toBe(false)
  })

  it('shows nothing on a proposal tab the rerun does not write again, and lets it be edited', async () => {
    await rerunning('world')
    expect(button('✎ Edit').disabled).toBe(true)
    feed!.push(waitingOn('creative-director'), stepOn('creative-director'))
    await settled()
    expect(progress()).toEqual([])
    expect(stale('.chain-runner-directing-proposal')).toBe(false)
    expect(button('✎ Edit').disabled).toBe(false)
  })

  it('shows the line under the tabs, over the greyed proposal, on a tab the rerun writes again', async () => {
    await rerunning('world', waitingOn('world', 'creative-director'), stepOn('world'))
    expect(progress()).toEqual(['⟳ world is running… 0:00'])
    expect(root.querySelector('.chain-runner-directing-tabs')?.nextElementSibling?.className).toBe('chain-runner-directing-progress')
    expect(stale('.chain-runner-directing-proposal')).toBe(true)
    expect(button('✎ Edit').disabled).toBe(true)
  })

  it('carries an open edit onto the run the rerun lands on', async () => {
    await rerunning('world', waitingOn('creative-director'))
    button('✎ Edit').click()
    type(root.querySelector<HTMLTextAreaElement>('.chain-runner-directing-editor textarea')!, 'A theme park.')
    feed!.end(complete(NEW))
    await settled()
    expect(header()).toContain('Xy9zW2')
    expect(root.querySelector<HTMLTextAreaElement>('.chain-runner-directing-editor textarea')?.value).toBe('A theme park.')
    expect(editors[0]!.destroyed).toBe(false)
  })

  it('closes an edit saved while the rerun lands', async () => {
    await rerunning('world', waitingOn('creative-director'))
    button('✎ Edit').click()
    type(root.querySelector<HTMLTextAreaElement>('.chain-runner-directing-editor textarea')!, 'A theme park.')
    button('Save').click()
    feed!.end(complete(NEW))
    await settled()
    expect(header()).toContain('Xy9zW2')
    expect(root.querySelector('.chain-runner-directing-editor')).toBeNull()
  })

  it('shows the line for a reply used as the revision on the Run tab', async () => {
    feed = new Feed()
    notes[PATH] = talking('@world who watches?\n> [turn 2]\n> \n> The player.')
    await openNote('world')
    button('Use this reply as the revision & rerun').click()
    await settled()
    expect(promoted).toEqual([{ nodeId: 'world', turn: 2 }])
    feed.push(...started(NEW), waitingOn('creative-director'), stepOn('creative-director'))
    await settled()
    expect(progress()).toEqual([])
    button('Run').click()
    tick(3)
    expect(progress()).toEqual(['⟳ Writing a new verdict… 0:03'])
  })

  it('puts the panel back as it was when the rerun lands nowhere', async () => {
    await rerunning(undefined, waitingOn('creative-director'), stepOn('creative-director'))
    feed!.end({ type: 'error', error: 'the chain broke' })
    await settled()
    expect(notices).toEqual([`Rerun ${NEW} failed: the chain broke`])
    expect(progress()).toEqual([])
    expect(stale('.chain-runner-directing-verdict')).toBe(false)
    expect(timers.size).toBe(0)
    expect(button('⟳ Rerun downstream').disabled).toBe(false)
    expect(header()).toContain('ubqPU2')
  })

  it('shows a rerun the palette started, as the drawing and the header read it, and lets go when it lands', async () => {
    feed = new Feed()
    await openNote()
    const going = holds.rerun(RUN)
    await settled()
    feed.push(...started(NEW), waitingOn('creative-director'), stepOn('creative-director'))
    await settled()
    tick(7)
    expect(reruns.rewriting(RUN, 'creative-director')?.step?.writesVerdict).toBe(true)
    expect(progress()).toEqual(['⟳ Writing a new verdict… 0:07'])
    expect(stale('.chain-runner-directing-verdict')).toBe(true)
    expect(button('Rerunning…').disabled).toBe(true)
    expect(button('▶ Resume · 1 of 2 canon ticked').disabled).toBe(true)
    feed.end(complete(NEW))
    await going
    await settled()
    expect(reruns.going(RUN)).toBeUndefined()
    expect(progress()).toEqual([])
    expect(header()).toContain('Xy9zW2')
  })

  it('starts nothing else on the run a rerun is landing on, until it has landed', async () => {
    const resume = (): HTMLButtonElement | null => root.querySelector('.chain-runner-directing-footer button')
    let whileLanding: { header: string; resume: boolean | undefined } | undefined
    reruns.onLanding(async () => {
      await settled()
      whileLanding = { header: header(), resume: resume()?.disabled }
    })
    await openNote()
    button('⟳ Rerun downstream').click()
    await settled()
    await settled()
    expect(whileLanding).toEqual({ header: expect.stringContaining('Xy9zW2'), resume: true })
    expect(resume()?.disabled).toBe(false)
  })

  it('shows no line for a run the panel has moved on from, and stays there when it lands', async () => {
    const made = board()
    feed = new Feed()
    made.show(RUN, await holds.read(RUN))
    button('⟳ Rerun downstream').click()
    await settled()
    made.show(NONE, undefined)
    expect(progress()).toEqual([])
    expect(timers.size).toBe(0)
    feed.end(...started(NEW), complete(NEW))
    await settled()
    expect(text()).toContain(`Run ${NONE} has no hold note yet.`)
  })
})

describe('the Run tab', () => {
  it('shows the verdict and the Direction so far', () => {
    open()
    expect(text()).toContain('A combat trial in a void.')
    expect(Array.from(root.querySelectorAll('li')).map(li => li.textContent)).toEqual(['KEEP: gameplay'])
  })

  it('says when nothing has been directed yet', () => {
    open(hold({ direction: [] }))
    expect(text()).toContain('Nothing directed yet')
  })

  it('lists every canon line, and unticks one in the note', async () => {
    open()
    expect(boxes().map(box => box.checked)).toEqual([true, false])
    expect(text()).toContain('1 of 2 ticked')
    boxes()[0]!.click()
    await settled()
    expect(notes[PATH]).toContain('- [ ] LOCKED: Abilities rotate. — gameplay')
    expect(text()).toContain('0 of 2 ticked')
  })

  it('has no verb buttons', () => {
    open()
    expect(has('KEEP')).toBe(false)
  })

  it('adds a CHANGE to the Direction from its own box', async () => {
    open()
    type(composer('What should change…'), 'rotation should hurt')
    press(composer('What should change…'), 'Enter')
    await settled()
    expect(await direction()).toEqual(['KEEP: gameplay', 'CHANGE: rotation should hurt'])
    expect(Array.from(root.querySelectorAll('li')).map(li => li.textContent)).toContain('CHANGE: rotation should hurt')
  })
})

describe('the Run tab, waiting at a hold', () => {
  const waitingAt = hold({
    canon: [],
    holds: [
      {
        nodeId: 'pick',
        prompt: 'Which pitch goes forward?',
        candidates: [
          { heading: 'Candidate 1', body: 'A combat trial.', ticked: false },
          { heading: 'Candidate 2', body: 'A quiet shrine.', ticked: true },
        ],
        chosen: 'Candidate 2',
      },
    ],
  })
  const section = (): string => root.querySelector('.chain-runner-directing-hold')?.textContent ?? ''

  it('names the node, asks its question, and shows each candidate', () => {
    open(waitingAt)
    expect(section()).toContain('Waiting at pick')
    expect(section()).toContain('Which pitch goes forward?')
    expect(section()).toContain('A combat trial.')
    expect(boxes().map(box => box.checked)).toEqual([false, true])
  })

  it('picks a candidate in the note by its heading', async () => {
    notes[PATH] = NOTE.replace('## Verdict', '## Waiting at pick\n\nReached then\n\n- [ ] Candidate 1\n  A trial.\n- [ ] Candidate 2\n  A shrine.\n\n## Verdict')
    await openNote()
    boxes()[0]!.click()
    await settled()
    expect((await holds.read(RUN))?.holds[0]?.chosen).toBe('Candidate 1')
  })

  it('says a hold offered no candidates', () => {
    open(hold({ holds: [{ nodeId: 'pick', candidates: [] }] }))
    expect(section()).toContain('No candidates')
  })

  it('shows nothing of a hold on a run that ended', () => {
    open()
    expect(root.querySelector('.chain-runner-directing-hold')).toBeNull()
  })

  it('shows nothing of the hold on a proposal tab', () => {
    open(waitingAt, 'world')
    expect(section()).toBe('')
  })
})

describe('a proposal tab, chatting', () => {
  const talked = hold({
    conversation: [
      { kind: 'chat', name: 'world', message: 'why a test?', reply: 'Someone is watching.', revisedAs: '2026-09-16-Xy9zW2' },
      { kind: 'room', question: 'too much Nier?', answers: [{ name: 'world', answer: 'No.' }] },
      { kind: 'chat', name: 'gameplay', message: 'why rotate?', reply: 'Fresh fights.' },
      { kind: 'chat', name: 'world', message: 'who watches?', reply: 'The player.', turn: 2 },
      { kind: 'chat', name: 'world', message: 'and then?' },
    ],
  })

  it('shows only this proposal’s messages and replies, in order', () => {
    open(talked, 'world')
    expect(turns()).toHaveLength(3)
    expect(turns()[0]).toContain('why a test?')
    expect(turns()[0]).toContain('Someone is watching.')
    expect(turns()[1]).toContain('who watches?')
    expect(turns()[2]).toContain('No reply')
    expect(text()).not.toContain('why rotate?')
    expect(text()).not.toContain('too much Nier?')
  })

  it('says which run a reply was revised as, and offers a reply not yet used', () => {
    open(talked, 'world')
    const shown = Array.from(root.querySelectorAll('.chain-runner-directing-turn'))
    expect(shown[0]?.textContent).toContain('Used as the revision · run Xy9zW2')
    expect(Array.from(shown[0]!.querySelectorAll('button'))).toEqual([])
    expect(has('Use this reply as the revision & rerun')).toBe(true)
  })

  it('revises with a reply, says a rerun is going and starts no second one, then follows the hold to where it landed', async () => {
    holdEngine()
    notes[PATH] = talking('@world who watches?\n> [turn 2]\n> \n> The player.')
    await openNote('world')
    button('Use this reply as the revision & rerun').click()
    expect(button('Rerunning…').disabled).toBe(true)
    button('Rerunning…').click()
    await settled()
    expect(promoted).toEqual([{ nodeId: 'world', turn: 2 }])
    release()
    await settled()
    expect(header()).toContain('Xy9zW2')
    expect(text()).toContain('Used as the revision · run Xy9zW2')
  })

  it('sends what is typed to this proposal, on Send or Enter', async () => {
    open(hold(), 'world')
    type(composer('Message world…'), 'really?')
    button('Send').click()
    await settled()
    type(composer('Message world…'), 'truly?')
    expect(press(composer('Message world…'), 'Enter').defaultPrevented).toBe(true)
    await settled()
    expect(chats).toEqual(['world really?', 'world truly?'])
    expect(turns()).toEqual(['really?Because it is.Use this reply as the revision & rerun', 'truly?Because it is.Use this reply as the revision & rerun'])
  })

  it('sends nothing for a blank box', () => {
    open(hold(), 'world')
    button('Send').click()
    press(composer('Message world…'), 'Enter')
    expect(notes[PATH]).toBe(NOTE)
  })

  it('sends on Shift+Enter too, since a message is one line', async () => {
    open(hold(), 'world')
    type(composer('Message world…'), 'two')
    expect(press(composer('Message world…'), 'Enter', true).defaultPrevented).toBe(true)
    await settled()
    expect(chats).toEqual(['world two'])
  })

  it('shows the message and that a reply is coming, and cannot send again while it does', async () => {
    holdEngine()
    open(hold(), 'world')
    type(composer('Message world…'), 'really?')
    button('Send').click()
    expect(composer('Message world…').value).toBe('')
    expect(turns()[0]).toContain('really?')
    expect(text()).toContain('world is replying…')
    expect(button('Send').disabled).toBe(true)
    type(composer('Message world…'), 'again?')
    press(composer('Message world…'), 'Enter')
    release()
    await settled()
    expect(chats).toEqual(['world really?'])
    expect(text()).not.toContain('world is replying…')
    expect(button('Send').disabled).toBe(false)
    expect(composer('Message world…').value).toBe('again?')
  })

  it('draws the message once the note has it, still waiting, rather than twice (ADR-0014)', async () => {
    holdEngine()
    open(hold(), 'world')
    type(composer('Message world…'), 'really\nso?')
    button('Send').click()
    await settled()
    expect(notes[PATH]).toContain('@world really so?')
    expect(turns()).toEqual(['really so?world is replying…'])
  })

  it('says a message the engine left unanswered has no reply, and leaves it in the note', async () => {
    chatFrames = [{ type: 'error', error: 'busy' }]
    open(hold(), 'world')
    type(composer('Message world…'), 'really?')
    button('Send').click()
    await settled()
    expect(turns()).toEqual(['really?No reply'])
    expect(composer('Message world…').value).toBe('')
  })

  it('puts the message back in the box when the note would not take it', async () => {
    store.refuse(PATH)
    open(hold(), 'world')
    type(composer('Message world…'), 'really?')
    button('Send').click()
    await settled()
    expect(composer('Message world…').value).toBe('really?')
    expect(text()).not.toContain('world is replying…')
  })

  it('keeps what is being typed, and where, when the note changes', async () => {
    open(hold(), 'world')
    const box = composer('Message world…')
    type(box, 'half a thou')
    box.focus()
    box.setSelectionRange(4, 4)
    await touched()
    expect(composer('Message world…')).toBe(box)
    expect(box.value).toBe('half a thou')
    expect(document.activeElement).toBe(box)
    expect(box.selectionStart).toBe(4)
  })

  it('keeps a draft to its own proposal', () => {
    open(hold(), 'world')
    type(composer('Message world…'), 'for world')
    button('gameplay').click()
    expect(composer('Message gameplay…').value).toBe('')
    button('world').click()
    expect(composer('Message world…').value).toBe('for world')
  })
})

describe('a proposal tab, side quests', () => {
  const quested = hold({
    conversation: [
      { kind: 'quest', name: 'world', chainName: 'combat lab', runId: '2026-09-16-quest1', result: 'The test becomes an arena.' },
      { kind: 'quest', name: 'gameplay', chainName: 'combat lab', runId: '2026-09-16-quest2', result: 'Rotation lands.' },
      { kind: 'quest', name: 'world', chainName: 'world lab' },
    ],
  })
  const chainBox = (): HTMLInputElement => {
    const found = root.querySelector<HTMLInputElement>('input[placeholder="Chain to send it through…"]')
    if (!found) throw new Error('no chain box')
    return found
  }
  const typeChain = (words: string): void => {
    chainBox().value = words
    chainBox().dispatchEvent(new Event('input'))
  }
  const quests = (): Element[] => Array.from(root.querySelectorAll('.chain-runner-directing-quests .chain-runner-directing-turn'))

  it('shows only this proposal’s side quests: the chain, its result, and a link to its run', () => {
    open(quested, 'world')
    expect(quests()).toHaveLength(2)
    expect(quests()[0]?.textContent).toContain('combat lab')
    expect(quests()[0]?.textContent).toContain('The test becomes an arena.')
    const link = quests()[0]?.querySelector('a')
    expect(link?.getAttribute('href')).toBe('http://engine/history/2026-09-16-quest1')
    expect(link?.textContent).toContain('quest1')
    expect(quests()[1]?.textContent).toContain('No result')
    expect(text()).not.toContain('Rotation lands.')
  })

  it('offers the engine’s chains to pick from', async () => {
    chainNames = ['combat lab', 'world lab']
    open(hold(), 'world')
    await settled()
    const list = root.querySelector<HTMLDataListElement>(`datalist#${chainBox().getAttribute('list')}`)
    expect(Array.from(list?.options ?? []).map(option => option.value)).toEqual(['combat lab', 'world lab'])
  })

  it('asks the engine for its chains when a tab opens, not on every redraw', async () => {
    chainNames = ['combat lab']
    open(hold(), 'world')
    await settled()
    await touched()
    expect(chainsAsked).toBe(1)
    chainNames = []
    button('gameplay').click()
    await settled()
    expect(chainsAsked).toBe(2)
    const list = root.querySelector<HTMLDataListElement>(`datalist#${chainBox().getAttribute('list')}`)
    expect(Array.from(list?.options ?? []).map(option => option.value)).toEqual(['combat lab'])
  })

  it('sends this proposal through the chain typed, saying the quest is going until it is done', async () => {
    holdEngine()
    open(hold(), 'world')
    typeChain('combat lab')
    press(chainBox(), 'Enter')
    expect(root.querySelector('.chain-runner-directing-quests')?.textContent).toContain('combat lab is running…')
    expect(button('Go').disabled).toBe(true)
    await settled()
    expect(requests.map(request => request.chainName)).toEqual(['combat lab'])
    release()
    await settled()
    expect(text()).not.toContain('is running…')
    expect(quests()[0]?.querySelector('a')?.getAttribute('href')).toBe(`http://engine/history/${QUEST}`)
  })

  it('says an edit still open is not what a quest sends', () => {
    open(hold(), 'world')
    expect(text()).not.toContain('Sends the proposal as last saved')
    button('✎ Edit').click()
    expect(text()).toContain('Sends the proposal as last saved')
  })

  it('keeps a chain being typed, and the focus, when the note changes', async () => {
    open(hold(), 'world')
    typeChain('comb')
    chainBox().focus()
    await touched()
    expect(chainBox().value).toBe('comb')
    expect(document.activeElement).toBe(chainBox())
  })
})

describe('the Run tab, talking to the room', () => {
  const asked = hold({
    conversation: [
      { kind: 'chat', name: 'world', message: 'why a test?', reply: 'Someone is watching.' },
      { kind: 'room', question: 'too much Nier?', answers: [{ name: 'gameplay', answer: 'A bit.' }, { name: 'world', answer: 'No.' }] },
    ],
  })

  it('shows each question with who answered what, and no chats', () => {
    open(asked)
    expect(turns()).toHaveLength(1)
    expect(turns()[0]).toMatch(/too much Nier\?.*gameplay.*A bit\..*world.*No\./)
    expect(text()).not.toContain('why a test?')
  })

  it('asks the room what is typed, and says the room is answering until it has', async () => {
    holdEngine()
    framesByAgent = { gameplay: answer('gameplay', 'Rotation.'), world: answer('world', 'The watcher.') }
    open()
    type(composer('Ask every proposal…'), 'what is the hook?')
    button('Ask').click()
    expect(text()).toContain('what is the hook?')
    expect(text()).toContain('The room is answering…')
    expect(button('Ask').disabled).toBe(true)
    await settled()
    expect(turns()).toEqual(['what is the hook?The room is answering…'])
    release()
    await settled()
    expect(text()).not.toContain('The room is answering…')
    expect(turns()[0]).toMatch(/gameplay.*Rotation\..*world.*The watcher\./)
  })
})

describe('drawing by key (ADR-0007)', () => {
  /** Every element under the panel, in document order. */
  const all = (): Element[] => Array.from(root.querySelectorAll('*'))

  it('keeps every element when the note changes and the hold reads the same', async () => {
    open(hold(), 'world')
    const before = all()
    await touched()
    expect(all()).toHaveLength(before.length)
    all().forEach((el, index) => expect(el).toBe(before[index]))
  })

  it('keeps the Run tab’s elements, changing only the one the note changed', async () => {
    open()
    const before = all()
    const verdict = root.querySelector('.chain-runner-directing-markdown')
    const list = root.querySelector('.chain-runner-directing-direction')
    notes[PATH] = NOTE.replace('A combat trial in a void.', 'A quiet shrine.').replace('KILL:', 'KILL: world')
    await touched()
    expect(root.querySelector('.chain-runner-directing-markdown')).toBe(verdict)
    expect(verdict?.textContent).toBe('A quiet shrine.')
    expect(root.querySelector('.chain-runner-directing-direction')).toBe(list)
    expect(before.filter(el => !root.contains(el))).toEqual([])
  })

  it('keeps the room box, and what is typed there, when the note changes', async () => {
    open()
    const box = composer('Ask every proposal…')
    type(box, 'half a que')
    box.focus()
    box.setSelectionRange(5, 5)
    await touched()
    expect(composer('Ask every proposal…')).toBe(box)
    expect(document.activeElement).toBe(box)
    expect(box.selectionStart).toBe(5)
  })

  it('keeps the editor in the one frame while a rerun streams', async () => {
    feed = new Feed()
    notes[PATH] = EDITED
    await openNote('world')
    button('⟳ Rerun downstream').click()
    await settled()
    feed.push(...started(NEW), waitingOn('creative-director'))
    await settled()
    button('✎ Edit').click()
    const frame = root.querySelector('.chain-runner-directing-editor')
    const progress = root.querySelector('.chain-runner-directing-footer')
    feed.push(stepOn('creative-director'))
    await settled()
    expect(root.querySelector('.chain-runner-directing-editor')).toBe(frame)
    expect(frame?.firstElementChild).toBe(editors[0]!.el)
    expect(root.querySelector('.chain-runner-directing-footer')).toBe(progress)
  })

  it('keeps the rerun’s progress line while its step changes', async () => {
    feed = new Feed()
    notes[PATH] = EDITED
    await openNote()
    button('⟳ Rerun downstream').click()
    await settled()
    feed.push(...started(NEW), waitingOn('creative-director'))
    await settled()
    const line = root.querySelector('.chain-runner-directing-progress')
    feed.push(stepOn('creative-director'))
    await settled()
    expect(root.querySelector('.chain-runner-directing-progress')).toBe(line)
    expect(line?.textContent).toContain('Writing a new verdict')
    expect(timers.size).toBe(1)
  })

  it('gives a tab its own elements, and lets them go when another tab opens', () => {
    open(hold(), 'world')
    const world = root.querySelector('.chain-runner-directing-proposal')
    button('gameplay').click()
    expect(root.querySelector('.chain-runner-directing-proposal')).not.toBe(world)
    expect(world?.isConnected).toBe(false)
  })
})

describe('without a hold', () => {
  it('says where to click when it is showing no run', () => {
    board()
    expect(text()).toContain('✎ Direct')
    expect(tabs()).toEqual([])
  })

  it('writes the hold for a run that has none, and shows it', async () => {
    board().show(NONE, undefined)
    expect(text()).toContain(`Run ${NONE} has no hold note yet.`)
    button('✎ Direct this run').click()
    await settled()
    expect(notes[`Maestro/holds/${NONE}.md`]).toContain(`# Hold: run ${NONE}`)
    expect(tabs()).toEqual(['Run', 'gameplay', 'world'])
  })
})

describe('resume', () => {
  /** What the bar pinned under every tab says. */
  const footer = (): string => root.querySelector('.chain-runner-directing-footer')?.textContent ?? ''
  const RESUME = '▶ Resume · 1 of 2 canon ticked'

  it('names how many canon lines are ticked', () => {
    open()
    expect(button(RESUME)).toBeTruthy()
  })

  it('drops the count for a hold with no canon lines at all', () => {
    open(hold({ canon: [] }))
    expect(button('▶ Resume')).toBeTruthy()
  })

  it('stays under every tab', () => {
    open(hold(), 'gameplay')
    expect(button(RESUME)).toBeTruthy()
  })

  it('says so while the run goes, and takes no second press', async () => {
    holdEngine()
    open()
    button(RESUME).click()
    expect(button('Resuming…').disabled).toBe(true)
    button('Resuming…').click()
    await settled()
    expect(resumed).toEqual([RUN])
    release()
    await settled()
    expect(notices.filter(notice => notice === ALREADY_GOING)).toEqual([])
    expect(text()).not.toContain('Resume did not run.')
  })

  it('says the hold was resumed, and that canon was written', async () => {
    open()
    button(RESUME).click()
    await settled()
    expect(footer()).toContain('Resumed')
    expect(footer()).toContain('canon written')
  })

  it('follows a resume that forks to the fork’s own hold, and says so there', async () => {
    resumeFrames = [...started(RESUMED), complete(RESUMED)]
    open(hold(), 'gameplay')
    button(RESUME).click()
    await settled()
    expect(header()).toContain('Rs1Kq4')
    expect(selectedTab()).toBe('gameplay')
    expect(root.querySelector<HTMLAnchorElement>('.chain-runner-directing-run-link')?.href).toBe(`http://engine/history/${RESUMED}`)
    expect(footer()).toContain('Resumed')
  })

  it('holds nothing of a resume that lands after the panel went away', async () => {
    holdEngine()
    resumeFrames = [...started(RESUMED), complete(RESUMED)]
    const made = open()
    button(RESUME).click()
    await settled()
    made.close()
    release()
    await settled()
    expect(text()).toContain('Click a card')
    made.show(RESUMED, await holds.read(RESUMED))
    expect(footer()).not.toContain('Resumed')
  })

  it('keeps the reader on their tab — what the run wrote comes back in the hold itself', async () => {
    open(hold(), 'gameplay')
    button(RESUME).click()
    await settled()
    expect(selectedTab()).toBe('gameplay')
  })

  it('says what the run is doing while it goes', async () => {
    feed = new Feed()
    open()
    button(RESUME).click()
    await settled()
    feed.push(...started(RUN), waitingOn('creative-director'), stepOn('creative-director'))
    await settled()
    expect(footer()).toContain('⟳ Writing a new verdict…')
  })

  it('says a run failed, and that its canon was held back', async () => {
    resumeFrames = [...started(RUN), { type: 'error', error: 'the model refused' }]
    open()
    button(RESUME).click()
    await settled()
    expect(text()).toContain('Failed: the model refused')
    expect(text()).toContain('canon not written')
  })

  it('says a resume that never ran did not run', async () => {
    online = false
    open()
    button(RESUME).click()
    await settled()
    expect(text()).toContain('Resume did not run.')
    expect(button(RESUME).disabled).toBe(false)
  })

  it('keeps what the last resume said when the note changes under it', async () => {
    open()
    button(RESUME).click()
    await settled()
    await touched()
    expect(footer()).toContain('canon written')
  })
})
