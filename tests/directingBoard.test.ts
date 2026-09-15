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
    { name: 'gameplay', text: 'Rotate abilities mid-fight.', given: ['KEEP'] },
    { name: 'world', text: 'A controlled test.', given: [] },
  ],
  direction: ['KEEP: gameplay'],
  canon: [
    { id: 'LOCKED: Abilities rotate. — gameplay', text: 'LOCKED: Abilities rotate.', proposer: 'gameplay', ticked: true },
    { id: 'LOCKED: A test. — world', text: 'LOCKED: A test.', proposer: 'world', ticked: false },
  ],
  ...over,
})

const showing = (reading: HoldReading = hold()): DirectingState => ({ kind: 'hold', hold: reading })

let root: HTMLElement
let calls: string[]
let released: number

function board(): DirectingBoard {
  return new DirectingBoard(root, {
    renderMarkdown: (text, into) => {
      into.append(document.createTextNode(text))
      return () => void released++
    },
    direct: (verb, proposal, other) => void calls.push(`direct ${verb} ${proposal}${other ? ` ${other}` : ''}`),
    tickCanon: (id, ticked) => void calls.push(`tick ${id} ${ticked}`),
    writeHold: () => void calls.push('write hold'),
    openMenu: () => void calls.push('menu'),
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

beforeEach(() => {
  document.body.replaceChildren()
  root = document.createElement('div')
  document.body.append(root)
  calls = []
  released = 0
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

  it('combines with whichever other proposal is picked', () => {
    board().open(showing(), 'gameplay')
    const combine = root.querySelector<HTMLSelectElement>('.chain-runner-directing-verbs select')!
    expect(Array.from(combine.options).map(option => option.value)).toEqual(['', 'world'])
    combine.value = 'world'
    combine.dispatchEvent(new Event('change'))
    expect(calls).toEqual(['direct COMBINE gameplay world'])
  })

  it('shows the proposal’s text', () => {
    board().open(showing(), 'world')
    expect(text()).toContain('A controlled test.')
  })

  it('clamps a long proposal until asked for the whole of it', () => {
    const long = hold({ proposals: [{ name: 'gameplay', text: 'word '.repeat(400), given: [] }] })
    board().open(showing(long), 'gameplay')
    expect(root.querySelector('.is-clamped')).not.toBeNull()
    button('Show the whole proposal').click()
    expect(root.querySelector('.is-clamped')).toBeNull()
    expect(button('Show less')).toBeDefined()
  })

  it('does not clamp a short one', () => {
    board().open(showing(), 'world')
    expect(root.querySelector('.is-clamped')).toBeNull()
    expect(buttons().some(b => b.textContent === 'Show the whole proposal')).toBe(false)
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
