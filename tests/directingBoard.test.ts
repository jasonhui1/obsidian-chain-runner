// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { DirectingBoard, type DirectingState } from '@/ui/directingBoard'
import type { HoldReading } from '@/ui/holdActions'

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
    { name: 'gameplay', text: 'Rotate abilities mid-fight.', given: ['KEEP'], combinedWith: [] },
    { name: 'world', text: 'A controlled test.', given: [], combinedWith: [] },
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
    revise: turn => answered(`revise ${turn.name} ${turn.reply}`).then(() => {}),
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
const press = (box: HTMLTextAreaElement, key: string, shiftKey = false): KeyboardEvent => {
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
        { name: 'gameplay', text: '', given: ['COMBINE'], combinedWith: ['world'] },
        { name: 'world', text: '', given: ['COMBINE'], combinedWith: ['gameplay'] },
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
