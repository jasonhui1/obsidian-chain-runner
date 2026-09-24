// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { ARRIVED_CLASS, ResultBoard, type BoardDeps } from '@/ui/resultBoard'
import type { RunPanel } from '@/run/panels'
import type { RunResult } from '@/run/session'
import type { LayoutKind } from '@/engine/types'

/**
 * The board draws by key, so what is checked here is what survives a draw: the
 * element a panel already has, the status word an edge transitions on, and a
 * markdown render that is not repeated for a panel that did not grow (ADR-0007).
 */

interface Render {
  text: string
  into: HTMLElement
  released: boolean
}

let root: HTMLElement
let renders: Render[]
let picked: number[]

function board(over: Partial<BoardDeps> = {}): ResultBoard {
  return new ResultBoard(root, {
    engine: () => ({ state: 'online', url: 'http://localhost:3000' }),
    renderMarkdown: (text, into) => {
      const render: Render = { text, into, released: false }
      renders.push(render)
      into.append(document.createTextNode(text))
      return () => void (render.released = true)
    },
    onPickRound: index => void picked.push(index),
    ...over,
  })
}

const panel = (over: Partial<RunPanel> = {}): RunPanel => ({
  name: 'hop 1',
  node: 'first',
  text: '',
  lines: 0,
  state: 'pending',
  ...over,
})

const filled = (over: Partial<RunPanel> = {}): RunPanel =>
  panel({ state: 'filled', text: 'landed', lines: 1, ...over })

function run(panels: RunPanel[], over: Partial<RunResult> = {}, kind: LayoutKind = 'timeline'): RunResult {
  return {
    chainName: 'Relay',
    moment: 'when a note needs a second read',
    seed: { note: 'Note', from: 'note' },
    status: 'running',
    layout: { kind, panels },
    ...over,
  }
}

const panelEls = (): HTMLElement[] => Array.from(root.querySelectorAll('.chain-runner-panel'))
const statusEl = (): HTMLElement => root.querySelector('.chain-runner-run-status') as HTMLElement
const roundEls = (): HTMLElement[] => Array.from(root.querySelectorAll('.chain-runner-round'))
const bodyText = (el: HTMLElement): string => el.querySelector('.chain-runner-panel-body')?.textContent ?? ''
const noticeText = (el: HTMLElement): string => el.querySelector('.chain-runner-panel-notice')?.textContent ?? ''

beforeEach(() => {
  root = document.createElement('div')
  document.body.replaceChildren(root)
  renders = []
  picked = []
})

describe('the board keeps the elements a draw still wants', () => {
  it('gives a panel back the element it had, filled in place', () => {
    const view = board()
    view.draw({ result: run([panel()]) })
    const before = panelEls()[0]
    view.draw({ result: run([filled()]) })
    expect(panelEls()[0]).toBe(before)
    expect(bodyText(before!)).toBe('landed')
  })

  it('transitions the status word on the element it is already on', () => {
    const view = board()
    view.draw({ result: run([filled()]) })
    const word = statusEl()
    expect(word.classList.contains('chain-runner-run-status--running')).toBe(true)
    view.draw({ result: run([filled()], { status: 'done' }) })
    expect(statusEl()).toBe(word)
    expect(word.textContent).toBe('done')
    expect(word.classList.contains('chain-runner-run-status--done')).toBe(true)
    expect(word.classList.contains('chain-runner-run-status--running')).toBe(false)
  })

  it('keeps a round row across a redraw, so a focused row stays focused', () => {
    const rounds = [panel({ round: 0 }), panel({ round: 1 })]
    const view = board()
    view.draw({ result: run(rounds, {}, 'sidebar') })
    const row = roundEls()[1]
    row!.focus()
    view.draw({ result: run([rounds[0]!, filled({ round: 1 })], {}, 'sidebar') })
    expect(roundEls()[1]).toBe(row)
    expect(document.activeElement).toBe(row)
  })

  it('reports a picked round rather than holding the pick', () => {
    const view = board()
    view.draw({ result: run([panel({ round: 0 }), panel({ round: 1 })], {}, 'sidebar') })
    roundEls()[1]!.click()
    expect(picked).toEqual([1])
  })

  it('drops a panel the run no longer has', () => {
    const view = board()
    view.draw({ result: run([filled({ node: 'a' }), filled({ node: 'b' })]) })
    view.draw({ result: run([filled({ node: 'a' })]) })
    expect(panelEls().length).toBe(1)
    expect(renders.filter(render => render.released).length).toBe(1)
  })
})

describe('the board re-renders only what grew', () => {
  it('leaves a panel that did not change alone', () => {
    const view = board()
    view.draw({ result: run([filled({ node: 'a' }), panel({ node: 'b' })]) })
    const before = renders.length
    view.draw({ result: run([filled({ node: 'a' }), panel({ node: 'b', streaming: 'half a sen' })]) })
    expect(renders.slice(before).map(render => render.text)).toEqual(['half a sen'])
  })

  it('releases the render it replaces, so a growing panel holds one', () => {
    const view = board()
    view.draw({ result: run([panel({ streaming: 'half' })]) })
    view.draw({ result: run([panel({ streaming: 'half a sen' })]) })
    expect(renders.map(render => render.released)).toEqual([true, false])
    expect(bodyText(panelEls()[0]!)).toBe('half a sen')
  })

  it('re-renders only the block a streaming panel is still writing', () => {
    const view = board()
    view.draw({ result: run([panel({ streaming: 'settled\n\nhalf a sen' })]) })
    const before = renders.length
    view.draw({ result: run([panel({ streaming: 'settled\n\nhalf a sentence' })]) })
    expect(renders.slice(before).map(render => render.text)).toEqual(['half a sentence'])
  })

  it('renders the whole answer in one pass when the panel lands', () => {
    const view = board()
    view.draw({ result: run([panel({ streaming: 'one\n\ntwo' })]) })
    const before = renders.length
    view.draw({ result: run([filled({ text: 'one\n\ntwo' })]) })
    expect(renders.slice(before).map(render => render.text)).toEqual(['one\n\ntwo'])
  })

  it('renders a panel once when it is drawn twice unchanged', () => {
    const view = board()
    const result = run([filled()])
    view.draw({ result })
    view.draw({ result })
    expect(renders.length).toBe(1)
  })
})

describe('the arrival cue', () => {
  it('marks a panel that landed filled where a pending one was', () => {
    const view = board()
    view.draw({ result: run([panel()]) })
    view.draw({ result: run([filled()]) })
    expect(panelEls()[0]!.classList.contains(ARRIVED_CLASS)).toBe(true)
  })

  it('does not fire on a panel that was already filled when it was first drawn', () => {
    const view = board()
    view.draw({ result: run([filled()], { status: 'done' }) })
    expect(panelEls()[0]!.classList.contains(ARRIVED_CLASS)).toBe(false)
  })

  it('leaves a panel that recovered from a failed hop uncued — it did not land, it changed', () => {
    const view = board()
    view.draw({ result: run([panel({ state: 'errored', error: 'this hop failed' })]) })
    view.draw({ result: run([filled()]) })
    expect(panelEls()[0]!.classList.contains(ARRIVED_CLASS)).toBe(false)
  })

  it('clears when the animation ends, so a later draw does not read as an arrival', () => {
    const view = board()
    view.draw({ result: run([panel()]) })
    view.draw({ result: run([filled()]) })
    const el = panelEls()[0]!
    el.dispatchEvent(new Event('animationend'))
    expect(el.classList.contains(ARRIVED_CLASS)).toBe(false)
    view.draw({ result: run([filled()], { status: 'done' }) })
    expect(el.classList.contains(ARRIVED_CLASS)).toBe(false)
  })
})

describe('what the board says around the panels', () => {
  it('shows the run header, and the notice a panel carries', () => {
    const view = board()
    view.draw({ result: run([panel()]) })
    expect(root.querySelector('.chain-runner-run-name')?.textContent).toBe('Relay')
    expect(noticeText(panelEls()[0]!)).toBe('waiting')
    view.draw({ result: run([panel()], { status: 'done' }) })
    expect(noticeText(panelEls()[0]!)).toBe('never ran')
  })

  it('names the run for readers and holds the run id in tooltips', () => {
    const view = board()
    view.draw({
      result: run([filled()], {
        runId: '2026-09-23-Wgvfl8',
        parameter: { name: 'role', value: 'engineers' },
      }),
    })
    const nameEl = root.querySelector('.chain-runner-run-name') as HTMLElement
    const runIdEl = root.querySelector('.chain-runner-run-id') as HTMLElement
    expect(nameEl.textContent).toBe('Relay · engineers')
    expect(nameEl.title).toBe('run 2026-09-23-Wgvfl8')
    expect(runIdEl.textContent).toBe('')
    expect(runIdEl.title).toBe('run 2026-09-23-Wgvfl8')
  })

  it('identifies a no-hint launch without presenting the source note as its seed', () => {
    const view = board()
    view.draw({ result: run([], { seed: { note: 'empty.md', from: 'none' } }) })

    const meta = root.querySelector('.chain-runner-run-meta')?.textContent ?? ''
    expect(meta).toContain('seed: no hint')
    expect(meta).not.toContain('empty.md')
  })

  it('drops the notice from a panel that landed, and the error line from a run that did not fail', () => {
    const view = board()
    view.draw({ result: run([panel()], { status: 'failed', error: 'the engine went away' }) })
    expect(root.querySelector('.chain-runner-run-error')?.textContent).toBe('the engine went away')
    view.draw({ result: run([filled()], { status: 'done' }) })
    expect(root.querySelector('.chain-runner-panel-notice')).toBeNull()
    expect(root.querySelector('.chain-runner-run-error')?.textContent ?? '').toBe('')
  })

  it('offers the panel actions only on a filled panel of a run with an id', () => {
    const saved: string[] = []
    const view = board({
      actions: {
        saveAsNote: chosen => void saved.push(chosen.name),
        sendToDrawing: () => {},
        keepLines: () => {},
      },
    })
    view.draw({ result: run([filled()]) })
    expect(root.querySelector('.chain-runner-panel-action')).toBeNull()
    view.draw({ result: run([filled()], { runId: 'r1' }) })
    const action = root.querySelector('.chain-runner-panel-action') as HTMLElement
    action.click()
    expect(saved).toEqual(['hop 1'])
  })

  it('says the empty state when a run has no panels yet, and drops it when one lands', () => {
    const view = board()
    view.draw({ result: run([]) })
    expect(root.querySelector('.chain-runner-empty--waiting')).not.toBeNull()
    view.draw({ result: run([filled()]) })
    expect(root.querySelector('.chain-runner-empty')).toBeNull()
  })

  it('says there is no run before one is launched', () => {
    board().draw({})
    expect(root.querySelector('.chain-runner-empty--idle')).not.toBeNull()
    expect(root.querySelector('.chain-runner-run-header')).toBeNull()
  })

  it('rebuilds when the layout changes shape, since the arrangement is a different one', () => {
    const view = board()
    view.draw({ result: run([filled()], {}, 'timeline') })
    const before = panelEls()[0]
    view.draw({ result: run([filled()], {}, 'columns') })
    expect(root.querySelector('.chain-runner-panels--columns')).not.toBeNull()
    expect(panelEls()[0]).not.toBe(before)
  })
})
