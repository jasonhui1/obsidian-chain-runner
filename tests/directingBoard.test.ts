// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { DirectingBoard, type DirectingState } from '@/ui/directingBoard'
import type { ProposalEditor } from '@/ui/proposalEditor'
import type { HoldReading, RerunStep, ResumeResult } from '@/ui/holdActions'

/**
 * The directing panel's elements: which tab shows what, and that every button
 * is handed to the hold actions rather than done here. What a hold reads as is
 * `holdActions.test.ts`.
 */

const RUN = '2026-09-15-ubqPU2'

const hold = (over: Partial<HoldReading> = {}): HoldReading => ({
  runId: RUN,
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
  ...over,
})

const showing = (reading: HoldReading = hold()): DirectingState => ({ kind: 'hold', hold: reading })

let root: HTMLElement
let calls: string[]
let released: number
let overflowing: boolean
/** Each call still waiting on the hold actions, answered by the test. */
let waiting: ((done: boolean) => void)[]
let chainNames: string[]
let chainsAsked: number
/** Each resume still waiting on the hold actions, answered by the test. */
let resumesWaiting: ((result: ResumeResult | undefined) => void)[]
/** Every editor the board has opened, in the order it opened them. */
let editors: FakeEditor[]
/** Hands the rerun going now the step the engine is on. */
let stepTo: (step: RerunStep) => void
let clock: number
/** The board's running timers, ticked by the test. */
let timers: Set<() => void>

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
    hasFocus: () => document.activeElement === el,
    focus: () => el.focus(),
    destroy: () => void (editor.destroyed = true),
  }
  editors.push(editor)
  return editor
}

const answered = (call: string): Promise<boolean> => {
  calls.push(call)
  return new Promise(resolve => waiting.push(resolve))
}

function board(): DirectingBoard {
  return new DirectingBoard(root, {
    renderMarkdown: (text, into) => {
      into.append(document.createTextNode(text))
      return () => void released++
    },
    direct: (verb, proposal, other) => void calls.push(`direct ${verb} ${proposal}${other ? ` ${other}` : ''}`),
    undirect: (verb, proposal, other) => void calls.push(`undirect ${verb} ${proposal}${other ? ` ${other}` : ''}`),
    tickCanon: (id, ticked) => void calls.push(`tick ${id} ${ticked}`),
    writeHold: () => void calls.push('write hold'),
    openMenu: () => void calls.push('menu'),
    chat: (proposal, message) => answered(`chat ${proposal} ${message}`),
    askRoom: question => answered(`ask ${question}`),
    change: text => answered(`change ${text}`),
    revise: (turn, onStep) => {
      stepTo = onStep
      return answered(`revise ${turn.name} ${turn.reply}`).then(() => {})
    },
    editProposal: (proposal, words) => answered(`edit ${proposal} ${words}`),
    rerun: onStep => {
      stepTo = onStep
      return answered('rerun').then(() => {})
    },
    resume: runId => {
      calls.push(`resume ${runId}`)
      return new Promise(resolve => resumesWaiting.push(resolve))
    },
    sideQuest: (proposal, chain) => answered(`quest ${proposal} ${chain}`),
    chains: () => {
      chainsAsked++
      return Promise.resolve(chainNames)
    },
    runUrl: runId => `http://engine/history/${runId}`,
    openEditor,
    now: () => clock,
    every: (_ms, tick) => {
      timers.add(tick)
      return () => void timers.delete(tick)
    },
    watchOverflow: (_frame, changed) => {
      changed(overflowing)
      return () => {}
    },
  })
}

const buttons = (): HTMLButtonElement[] => Array.from(root.querySelectorAll('button'))
const button = (text: string): HTMLButtonElement => {
  const found = buttons().find(candidate => candidate.textContent === text)
  if (!found) throw new Error(`no "${text}" button among ${buttons().map(b => b.textContent).join(', ')}`)
  return found
}
const tabs = (): string[] => Array.from(root.querySelectorAll('[role="tab"]')).map(tab => tab.textContent ?? '')
const selectedTab = (): string | null | undefined => root.querySelector('[role="tab"][aria-selected="true"]')?.textContent
const boxes = (): HTMLInputElement[] => Array.from(root.querySelectorAll('input[type="checkbox"]'))
const text = (): string => root.textContent ?? ''
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
/** Lets the board's awaited answers land. */
const settled = (): Promise<void> => new Promise(resolve => setTimeout(resolve))

beforeEach(() => {
  document.body.replaceChildren()
  root = document.createElement('div')
  document.body.append(root)
  calls = []
  released = 0
  overflowing = false
  waiting = []
  chainNames = []
  chainsAsked = 0
  resumesWaiting = []
  editors = []
  stepTo = () => {}
  clock = 0
  timers = new Set()
})

describe('header', () => {
  it('names the chain and the run’s short id', () => {
    board().open(showing())
    const header = root.querySelector('.chain-runner-directing-header')
    expect(header?.textContent).toContain('creative-director')
    expect(header?.textContent).toContain('ubqPU2')
  })

  it('opens the ⋯ menu', () => {
    board().open(showing())
    root.querySelector<HTMLButtonElement>('[aria-label="More"]')?.click()
    expect(calls).toEqual(['menu'])
  })
})

describe('tabs', () => {
  it('has Run, then one tab per proposal', () => {
    board().open(showing())
    expect(tabs()).toEqual(['Run', 'gameplay', 'world'])
  })

  it('opens on the Run tab when no proposal is named', () => {
    board().open(showing())
    expect(selectedTab()).toBe('Run')
  })

  it('opens on the proposal a card named', () => {
    board().open(showing(), 'world')
    expect(selectedTab()).toBe('world')
  })

  it('falls back to Run for a proposal the hold does not have', () => {
    board().open(showing(), 'nobody')
    expect(selectedTab()).toBe('Run')
  })

  it('switches on a click, and keeps the tab across a redraw', () => {
    const panel = board()
    panel.open(showing())
    button('gameplay').click()
    expect(selectedTab()).toBe('gameplay')
    panel.draw(showing())
    expect(selectedTab()).toBe('gameplay')
  })

  it('releases every markdown render a redraw replaces', () => {
    const panel = board()
    panel.open(showing())
    panel.draw(showing())
    expect(released).toBe(1)
  })

  it('shows the top of a tab it switches to', () => {
    board().open(showing())
    const body = root.querySelector<HTMLElement>('.chain-runner-directing-body')!
    body.scrollTop = 200
    button('world').click()
    expect(root.querySelector<HTMLElement>('.chain-runner-directing-body')!.scrollTop).toBe(0)
  })
})

describe('a proposal tab', () => {
  it('has a button for each verb but COMBINE, those already given marked', () => {
    board().open(showing(), 'gameplay')
    const verbs = Array.from(root.querySelectorAll<HTMLButtonElement>('.chain-runner-directing-verbs button'))
    expect(verbs.map(verb => verb.textContent)).toEqual(['KEEP', 'KILL', 'PUSH', 'REDUCE', 'MUTATE'])
    expect(verbs.filter(verb => verb.getAttribute('aria-pressed') === 'true').map(verb => verb.textContent)).toEqual(['KEEP'])
  })

  it('hands a verb to the hold actions, for this proposal', () => {
    board().open(showing(), 'world')
    button('PUSH').click()
    expect(calls).toEqual(['direct PUSH world'])
  })

  it('takes back a verb already given, rather than giving it twice', () => {
    board().open(showing(), 'gameplay')
    button('KEEP').click()
    expect(calls).toEqual(['undirect KEEP gameplay'])
  })

  it('combines with whichever other proposal is picked', () => {
    board().open(showing(), 'gameplay')
    const combine = root.querySelector<HTMLSelectElement>('.chain-runner-directing-verbs select')!
    expect(Array.from(combine.options).map(option => option.value)).toEqual(['', 'world'])
    combine.value = 'world'
    combine.dispatchEvent(new Event('change'))
    expect(calls).toEqual(['direct COMBINE gameplay world'])
  })

  it('marks a proposal already combined with, and takes that COMBINE back when picked again', () => {
    const combined = hold({
      proposals: [
        { name: 'gameplay', text: '', given: ['COMBINE'], combinedWith: ['world'], edited: false },
        { name: 'world', text: '', given: ['COMBINE'], combinedWith: ['gameplay'], edited: false },
      ],
    })
    board().open(showing(combined), 'gameplay')
    const combine = root.querySelector<HTMLSelectElement>('.chain-runner-directing-verbs select')!
    expect(combine.options[1]!.textContent).toBe('✓ world')
    combine.value = 'world'
    combine.dispatchEvent(new Event('change'))
    expect(calls).toEqual(['undirect COMBINE gameplay world'])
  })

  it('shows the proposal’s text', () => {
    board().open(showing(), 'world')
    expect(text()).toContain('A controlled test.')
  })

  it('offers the whole proposal once its text is cut off, and shows all of it when asked', () => {
    overflowing = true
    board().open(showing(), 'gameplay')
    expect(root.querySelector('.is-clamped')).not.toBeNull()
    expect(button('Show the whole proposal').hidden).toBe(false)
    button('Show the whole proposal').click()
    expect(root.querySelector('.is-clamped')).toBeNull()
    expect(button('Show less').hidden).toBe(false)
  })

  it('offers nothing when none of the text is cut off', () => {
    board().open(showing(), 'world')
    expect(button('Show the whole proposal').hidden).toBe(true)
    expect(root.querySelector('.is-overflowing')).toBeNull()
  })

  it('lists only that proposal’s canon lines, and hands a tick to the hold actions', () => {
    board().open(showing(), 'world')
    expect(boxes()).toHaveLength(1)
    expect(boxes()[0]!.checked).toBe(false)
    boxes()[0]!.click()
    expect(calls).toEqual(['tick LOCKED: A test. — world true'])
  })
})

describe('a proposal tab, editing', () => {
  const editor = (): HTMLTextAreaElement | null => root.querySelector('.chain-runner-directing-editor textarea')
  const open = (): void => button('✎ Edit').click()

  it('turns the proposal’s text into an editor holding its words, with Save and Cancel', () => {
    board().open(showing(), 'world')
    open()
    expect(editor()?.value).toBe('A controlled test.')
    expect(buttons().map(b => b.textContent)).toEqual(expect.arrayContaining(['Save', 'Cancel']))
    expect(buttons().some(b => b.textContent === '✎ Edit')).toBe(false)
  })

  it('hands the edited words to the hold actions on Save, and closes the editor once they are kept', async () => {
    board().open(showing(), 'world')
    open()
    type(editor()!, 'A real world.\n\nWith a second line.')
    button('Save').click()
    expect(calls).toEqual(['edit world A real world.\n\nWith a second line.'])
    expect(button('Save').disabled).toBe(true)
    waiting[0]!(true)
    await settled()
    expect(editor()).toBeNull()
  })

  it('keeps the editor open, with its words, when they could not be kept', async () => {
    board().open(showing(), 'world')
    open()
    type(editor()!, 'A real world.')
    button('Save').click()
    waiting[0]!(false)
    await settled()
    expect(editor()?.value).toBe('A real world.')
    expect(button('Save').disabled).toBe(false)
  })

  it('cannot save blank words', () => {
    board().open(showing(), 'world')
    open()
    type(editor()!, ' \n ')
    expect(button('Save').disabled).toBe(true)
    type(editor()!, 'Words.')
    expect(button('Save').disabled).toBe(false)
  })

  it('puts the proposal back as it was on Cancel', () => {
    board().open(showing(), 'world')
    open()
    type(editor()!, 'A real world.')
    button('Cancel').click()
    expect(editor()).toBeNull()
    expect(calls).toEqual([])
    button('✎ Edit').click()
    expect(editor()?.value).toBe('A controlled test.')
  })

  it('keeps the one editor, with its words and the focus, across a redraw', () => {
    const panel = board()
    panel.open(showing(), 'world')
    open()
    type(editor()!, 'half an edit')
    editor()!.focus()
    panel.draw(showing())
    expect(editors).toHaveLength(1)
    expect(editor()).toBe(editors[0]!.el)
    expect(editor()?.value).toBe('half an edit')
    expect(document.activeElement).toBe(editor())
  })

  it('leaves the editor be when the reader is typing somewhere else', () => {
    const panel = board()
    panel.open(showing(), 'world')
    open()
    composer('Message world…').focus()
    panel.draw(showing())
    expect(document.activeElement).toBe(composer('Message world…'))
  })

  it('lets go of the editor on Cancel, and again once the words are kept', async () => {
    board().open(showing(), 'world')
    open()
    button('Cancel').click()
    expect(editors[0]!.destroyed).toBe(true)
    open()
    type(editor()!, 'A real world.')
    button('Save').click()
    waiting[0]!(true)
    await settled()
    expect(editors[1]!.destroyed).toBe(true)
    expect(editors).toHaveLength(2)
  })

  it('keeps the editor it has when the words could not be kept', async () => {
    board().open(showing(), 'world')
    open()
    type(editor()!, 'A real world.')
    button('Save').click()
    waiting[0]!(false)
    await settled()
    expect(editors[0]!.destroyed).toBe(false)
    expect(editors).toHaveLength(1)
  })

  it('lets go of every open editor when the panel goes away', () => {
    const panel = board()
    panel.open(showing(), 'world')
    open()
    panel.close()
    panel.draw({ kind: 'idle' })
    expect(editors[0]!.destroyed).toBe(true)
    expect(editor()).toBeNull()
  })
})

describe('rerunning downstream', () => {
  const edited = hold({
    proposals: [
      { name: 'gameplay', text: 'Rotate stances.', given: [], combinedWith: [], edited: true },
      { name: 'world', text: 'A controlled test.', given: [], combinedWith: [], edited: false },
    ],
  })

  it('offers no rerun while no proposal is edited', () => {
    board().open(showing(), 'world')
    expect(buttons().some(b => b.textContent === '⟳ Rerun downstream')).toBe(false)
  })

  it('offers a rerun once a proposal is edited, naming the edited proposals, on any tab', () => {
    board().open(showing(edited), 'world')
    expect(button('⟳ Rerun downstream')).toBeDefined()
    expect(root.querySelector('.chain-runner-directing-rerun')?.textContent).toContain('gameplay')
    expect(root.querySelector('.chain-runner-directing-rerun')?.textContent).not.toContain('world')
    button('Run').click()
    expect(button('⟳ Rerun downstream')).toBeDefined()
  })

  it('starts no rerun while an edit is open, so no unsaved words are left behind', () => {
    const talked = hold({ ...edited, conversation: [{ kind: 'chat', name: 'world', message: 'why?', reply: 'Because.' }] })
    board().open(showing(talked), 'world')
    button('✎ Edit').click()
    expect(button('⟳ Rerun downstream').disabled).toBe(true)
    expect(button('Use this reply as the revision & rerun').disabled).toBe(true)
    expect(text()).toContain('Save or cancel the edit first')
    button('Cancel').click()
    expect(button('⟳ Rerun downstream').disabled).toBe(false)
  })

  it('hands the rerun to the hold actions, and starts no other rerun until it is done', async () => {
    const talked = hold({
      ...edited,
      conversation: [{ kind: 'chat', name: 'world', message: 'why?', reply: 'Because.' }],
    })
    board().open(showing(talked), 'world')
    button('⟳ Rerun downstream').click()
    expect(calls).toEqual(['rerun'])
    expect(button('Rerunning…').disabled).toBe(true)
    expect(button('Use this reply as the revision & rerun').disabled).toBe(true)
    expect(button('✎ Edit').disabled).toBe(true)
    button('Rerunning…').click()
    expect(calls).toEqual(['rerun'])
    waiting[0]!(true)
    await settled()
    expect(button('⟳ Rerun downstream').disabled).toBe(false)
  })
})

describe('a rerun going', () => {
  const edited = hold({
    proposals: [
      { name: 'gameplay', text: 'Rotate stances.', given: [], combinedWith: [], edited: true },
      { name: 'world', text: 'A controlled test.', given: [], combinedWith: [], edited: false },
    ],
  })
  const progress = (): string[] => Array.from(root.querySelectorAll('.chain-runner-directing-progress')).map(line => line.textContent ?? '')
  const tick = (seconds: number): void => {
    clock += seconds * 1000
    timers.forEach(one => one())
  }

  it('shows the step and a timer over the old verdict, greyed out, on the Run tab', () => {
    board().open(showing(edited))
    button('⟳ Rerun downstream').click()
    expect(progress()).toEqual(['⟳ Starting the rerun… 0:00'])
    stepTo({ name: 'director', writesVerdict: true })
    tick(42)
    expect(progress()).toEqual(['⟳ director is writing a new verdict… 0:42'])
    const verdict = root.querySelector('.chain-runner-directing-verdict')
    expect(verdict?.classList.contains('is-stale')).toBe(true)
    expect(verdict?.textContent).toContain('A combat trial in a void.')
  })

  it('names a step that is not the verdict as running', () => {
    board().open(showing(edited))
    button('⟳ Rerun downstream').click()
    stepTo({ name: 'world', writesVerdict: false })
    tick(65)
    expect(progress()).toEqual(['⟳ world is running… 1:05'])
  })

  it('shows the same line on a proposal tab, under the rerun bar', () => {
    board().open(showing(edited), 'world')
    button('⟳ Rerun downstream').click()
    stepTo({ name: 'director', writesVerdict: true })
    expect(progress()).toEqual(['⟳ director is writing a new verdict… 0:00'])
    expect(root.querySelector('.chain-runner-directing-rerun')?.nextElementSibling?.className).toBe('chain-runner-directing-progress')
  })

  it('shows the line for a reply used as the revision, where no rerun bar is', () => {
    const talked = hold({ conversation: [{ kind: 'chat', name: 'world', message: 'why?', reply: 'Because.' }] })
    board().open(showing(talked), 'world')
    button('Use this reply as the revision & rerun').click()
    stepTo({ name: 'director', writesVerdict: true })
    tick(3)
    expect(progress()).toEqual(['⟳ director is writing a new verdict… 0:03'])
  })

  it('puts the panel back as it was when the rerun lands nowhere', async () => {
    board().open(showing(edited))
    button('⟳ Rerun downstream').click()
    stepTo({ name: 'director', writesVerdict: true })
    waiting[0]!(false)
    await settled()
    expect(progress()).toEqual([])
    expect(root.querySelector('.chain-runner-directing-verdict')?.classList.contains('is-stale')).toBe(false)
    expect(timers.size).toBe(0)
    stepTo({ name: 'late', writesVerdict: false })
    expect(progress()).toEqual([])
  })

  it('shows no line for a run the panel has moved on from', () => {
    const b = board()
    b.open(showing(edited))
    button('⟳ Rerun downstream').click()
    b.draw(showing(hold({ runId: '2026-09-16-Xy9zW2' })))
    expect(progress()).toEqual([])
    expect(timers.size).toBe(0)
  })
})

describe('the Run tab', () => {
  it('shows the verdict and the Direction so far', () => {
    board().open(showing())
    expect(text()).toContain('A combat trial in a void.')
    expect(Array.from(root.querySelectorAll('li')).map(li => li.textContent)).toEqual(['KEEP: gameplay'])
  })

  it('says when nothing has been directed yet', () => {
    board().open(showing(hold({ direction: [] })))
    expect(text()).toContain('Nothing directed yet')
  })

  it('lists every canon line, and hands an untick to the hold actions', () => {
    board().open(showing())
    expect(boxes().map(box => box.checked)).toEqual([true, false])
    expect(text()).toContain('1 of 2 ticked')
    boxes()[0]!.click()
    expect(calls).toEqual(['tick LOCKED: Abilities rotate. — gameplay false'])
  })

  it('has no verb buttons', () => {
    board().open(showing())
    expect(buttons().some(b => b.textContent === 'KEEP')).toBe(false)
  })
})

describe('a proposal tab, chatting', () => {
  const talked = hold({
    conversation: [
      { kind: 'chat', name: 'world', message: 'why a test?', reply: 'Someone is watching.', revisedAs: '2026-09-16-Xy9zW2' },
      { kind: 'room', question: 'too much Nier?', answers: [{ name: 'world', answer: 'No.' }] },
      { kind: 'chat', name: 'gameplay', message: 'why rotate?', reply: 'Fresh fights.' },
      { kind: 'chat', name: 'world', message: 'who watches?', reply: 'The player.' },
      { kind: 'chat', name: 'world', message: 'and then?' },
    ],
  })

  it('shows only this proposal’s messages and replies, in order', () => {
    board().open(showing(talked), 'world')
    const turns = Array.from(root.querySelectorAll('.chain-runner-directing-turn')).map(turn => turn.textContent)
    expect(turns).toHaveLength(3)
    expect(turns[0]).toContain('why a test?')
    expect(turns[0]).toContain('Someone is watching.')
    expect(turns[1]).toContain('who watches?')
    expect(turns[2]).toContain('No reply')
    expect(text()).not.toContain('why rotate?')
    expect(text()).not.toContain('too much Nier?')
  })

  it('says which run a reply was revised as, and offers a reply not yet used', () => {
    board().open(showing(talked), 'world')
    const turns = Array.from(root.querySelectorAll('.chain-runner-directing-turn'))
    expect(turns[0]?.textContent).toContain('Used as the revision · run Xy9zW2')
    expect(Array.from(turns[0]!.querySelectorAll('button'))).toEqual([])
    button('Use this reply as the revision & rerun').click()
    expect(calls).toEqual(['revise world The player.'])
  })

  it('says a rerun is going, and starts no second one, until it is done', async () => {
    board().open(showing(talked), 'world')
    button('Use this reply as the revision & rerun').click()
    expect(button('Rerunning…').disabled).toBe(true)
    button('Rerunning…').click()
    expect(calls).toHaveLength(1)
    waiting[0]!(true)
    await settled()
    expect(button('Use this reply as the revision & rerun').disabled).toBe(false)
  })

  it('hands what is typed to the hold actions, for this proposal, on Send or Enter', async () => {
    board().open(showing(), 'world')
    type(composer('Message world…'), 'really?')
    button('Send').click()
    waiting[0]!(true)
    await settled()
    type(composer('Message world…'), 'truly?')
    expect(press(composer('Message world…'), 'Enter').defaultPrevented).toBe(true)
    expect(calls).toEqual(['chat world really?', 'chat world truly?'])
  })

  it('sends nothing for a blank box', () => {
    board().open(showing(), 'world')
    button('Send').click()
    press(composer('Message world…'), 'Enter')
    expect(calls).toEqual([])
  })

  it('sends on Shift+Enter too, since a message is one line', () => {
    board().open(showing(), 'world')
    type(composer('Message world…'), 'two')
    expect(press(composer('Message world…'), 'Enter', true).defaultPrevented).toBe(true)
    expect(calls).toEqual(['chat world two'])
  })

  it('shows the message and that a reply is coming, and cannot send again while it does', async () => {
    board().open(showing(), 'world')
    type(composer('Message world…'), 'really?')
    button('Send').click()
    expect(composer('Message world…').value).toBe('')
    expect(root.querySelector('.chain-runner-directing-turn')?.textContent).toContain('really?')
    expect(text()).toContain('world is replying…')
    expect(button('Send').disabled).toBe(true)
    type(composer('Message world…'), 'again?')
    press(composer('Message world…'), 'Enter')
    expect(calls).toEqual(['chat world really?'])

    waiting[0]!(true)
    await settled()
    expect(text()).not.toContain('world is replying…')
    expect(button('Send').disabled).toBe(false)
    expect(composer('Message world…').value).toBe('again?')
  })

  it('puts the message back in the box when it could not be sent', async () => {
    board().open(showing(), 'world')
    type(composer('Message world…'), 'really?')
    button('Send').click()
    waiting[0]!(false)
    await settled()
    expect(composer('Message world…').value).toBe('really?')
    expect(text()).not.toContain('world is replying…')
  })

  it('keeps what is being typed, and where, across a redraw', () => {
    const panel = board()
    panel.open(showing(), 'world')
    const box = composer('Message world…')
    type(box, 'half a thou')
    box.focus()
    box.setSelectionRange(4, 4)
    panel.draw(showing())
    const again = composer('Message world…')
    expect(again).not.toBe(box)
    expect(again.value).toBe('half a thou')
    expect(document.activeElement).toBe(again)
    expect(again.selectionStart).toBe(4)
  })

  it('keeps a draft to its own proposal', () => {
    board().open(showing(), 'world')
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
      { kind: 'quest', name: 'world', chainName: 'develop-direction' },
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
    board().open(showing(quested), 'world')
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
    chainNames = ['combat lab', 'develop-direction']
    board().open(showing(), 'world')
    await settled()
    const list = root.querySelector<HTMLDataListElement>(`datalist#${chainBox().getAttribute('list')}`)
    expect(Array.from(list?.options ?? []).map(option => option.value)).toEqual(['combat lab', 'develop-direction'])
  })

  it('asks the engine for its chains when a tab opens, not on every redraw', async () => {
    chainNames = ['combat lab']
    const panel = board()
    panel.open(showing(), 'world')
    await settled()
    panel.draw(showing())
    expect(chainsAsked).toBe(1)
    chainNames = []
    button('gameplay').click()
    await settled()
    expect(chainsAsked).toBe(2)
    const list = root.querySelector<HTMLDataListElement>(`datalist#${chainBox().getAttribute('list')}`)
    expect(Array.from(list?.options ?? []).map(option => option.value)).toEqual(['combat lab'])
  })

  it('takes a typed chain when the engine offers none', async () => {
    board().open(showing(), 'world')
    await settled()
    typeChain('combat lab')
    press(chainBox(), 'Enter')
    expect(calls).toEqual(['quest world combat lab'])
  })

  it('hands the chain to the hold actions, for this proposal, and says the quest is going until it is done', async () => {
    board().open(showing(), 'world')
    typeChain('combat lab')
    button('Go').click()
    expect(calls).toEqual(['quest world combat lab'])
    expect(root.querySelector('.chain-runner-directing-quests')?.textContent).toContain('combat lab is running…')
    expect(button('Go').disabled).toBe(true)
    waiting[0]!(true)
    await settled()
    expect(text()).not.toContain('is running…')
  })

  it('says an edit still open is not what a quest sends', () => {
    board().open(showing(), 'world')
    expect(text()).not.toContain('Sends the proposal as last saved')
    button('✎ Edit').click()
    expect(text()).toContain('Sends the proposal as last saved')
  })

  it('keeps a chain being typed, and the focus, across a redraw', () => {
    const panel = board()
    panel.open(showing(), 'world')
    typeChain('comb')
    chainBox().focus()
    panel.draw(showing())
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
    board().open(showing(asked))
    const turns = Array.from(root.querySelectorAll('.chain-runner-directing-turn')).map(turn => turn.textContent ?? '')
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatch(/too much Nier\?.*gameplay.*A bit\..*world.*No\./)
    expect(text()).not.toContain('why a test?')
  })

  it('asks the room what is typed, and says the room is answering until it has', async () => {
    board().open(showing())
    type(composer('Ask every proposal…'), 'what is the hook?')
    button('Ask').click()
    expect(calls).toEqual(['ask what is the hook?'])
    expect(text()).toContain('what is the hook?')
    expect(text()).toContain('The room is answering…')
    expect(button('Ask').disabled).toBe(true)
    waiting[0]!(true)
    await settled()
    expect(text()).not.toContain('The room is answering…')
  })

  it('adds a CHANGE to the Direction from its own box', () => {
    board().open(showing())
    type(composer('What should change…'), 'rotation should hurt')
    press(composer('What should change…'), 'Enter')
    expect(calls).toEqual(['change rotation should hurt'])
  })
})

describe('without a hold', () => {
  it('says where to click when it is showing no run', () => {
    board().open({ kind: 'idle' })
    expect(text()).toContain('✎ Direct')
    expect(tabs()).toEqual([])
  })

  it('offers to write the hold for a run that has none', () => {
    board().open({ kind: 'missing', runId: RUN })
    expect(text()).toContain(`Run ${RUN} has no hold note yet.`)
    button('✎ Direct this run').click()
    expect(calls).toEqual(['write hold'])
  })
})

describe('resume', () => {
  const resumed = (over: Partial<ResumeResult> = {}): ResumeResult => ({
    runId: '2026-09-16-pitch1',
    pitch: 'A combat trial in a void.',
    canon: 'written',
    ...over,
  })

  const land = async (result: ResumeResult | undefined): Promise<void> => {
    resumesWaiting.pop()?.(result)
    await settled()
  }

  it('names how many canon lines are ticked', () => {
    board().open(showing())
    expect(button('▶ Resume · 1 of 2 canon ticked')).toBeTruthy()
  })

  it('drops the count for a hold with no canon lines at all', () => {
    board().open(showing(hold({ canon: [] })))
    expect(button('▶ Resume')).toBeTruthy()
  })

  it('stays under every tab', () => {
    const made = board()
    made.open(showing(), 'gameplay')
    expect(button('▶ Resume · 1 of 2 canon ticked')).toBeTruthy()
  })

  it('says so while the run goes, and takes no second press', () => {
    board().open(showing())
    button('▶ Resume · 1 of 2 canon ticked').click()
    expect(button('Resuming…').disabled).toBe(true)
    expect(calls).toEqual([`resume ${RUN}`])
  })

  it('shows the Greenlight Pitch, and the run it came from, without opening a browser', async () => {
    board().open(showing())
    button('▶ Resume · 1 of 2 canon ticked').click()
    await land(resumed())
    expect(text()).toContain('Greenlight Pitch')
    expect(text()).toContain('A combat trial in a void.')
    expect(root.querySelector<HTMLAnchorElement>('.chain-runner-directing-run-link')?.href).toBe('http://engine/history/2026-09-16-pitch1')
  })

  it('opens the Run tab on landing, so the pitch is on screen', async () => {
    const made = board()
    made.open(showing(), 'gameplay')
    button('▶ Resume · 1 of 2 canon ticked').click()
    await land(resumed())
    expect(selectedTab()).toBe('Run')
    expect(text()).toContain('A combat trial in a void.')
  })

  it('says canon was written', async () => {
    board().open(showing())
    button('▶ Resume · 1 of 2 canon ticked').click()
    await land(resumed())
    expect(text()).toContain('canon written')
  })

  it('says a landed run pitched nothing, rather than passing off what else it wrote', async () => {
    board().open(showing())
    button('▶ Resume · 1 of 2 canon ticked').click()
    await land({ runId: '2026-09-16-pitch1', canon: 'written' })
    expect(text()).toContain('Greenlight Pitch')
    expect(text()).toContain('The run pitched nothing.')
  })

  it('says a run failed, and that its canon was held back, instead of a pitch', async () => {
    board().open(showing())
    button('▶ Resume · 1 of 2 canon ticked').click()
    await land({ runId: '2026-09-16-pitch1', error: 'the model refused', canon: 'held-back' })
    expect(text()).toContain('Failed: the model refused')
    expect(text()).toContain('canon not written')
    expect(text()).not.toContain('Greenlight Pitch')
  })

  it('says a resume that never ran did not run', async () => {
    board().open(showing())
    button('▶ Resume · 1 of 2 canon ticked').click()
    await land(undefined)
    expect(text()).toContain('Resume did not run.')
    expect(button('▶ Resume · 1 of 2 canon ticked').disabled).toBe(false)
  })

  it('keeps the pitch when the hold is redrawn under it', async () => {
    const made = board()
    made.open(showing())
    button('▶ Resume · 1 of 2 canon ticked').click()
    await land(resumed())
    made.draw(showing())
    expect(text()).toContain('A combat trial in a void.')
  })
})
