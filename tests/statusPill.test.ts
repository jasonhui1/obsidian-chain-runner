import { describe, it, expect } from 'vitest'
import { PILL_CLASS, describeEngineState, renderStatusPill } from '@/ui/statusPill'
import type { EngineState } from '@/engine/status'

const URL = 'http://localhost:3000'

/** Just enough of an element for the pill: the status-bar item Obsidian hands over. */
function statusBarItem() {
  const classes = new Set(['status-bar-item'])
  return {
    textContent: '',
    attributes: new Map<string, string>(),
    classList: {
      add: (name: string) => void classes.add(name),
      toggle: (name: string, on: boolean) => void (on ? classes.add(name) : classes.delete(name)),
    },
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value)
    },
    classes,
  }
}

describe('describeEngineState', () => {
  it('distinguishes all three states', () => {
    const states: EngineState[] = ['unknown', 'online', 'offline']
    const modifiers = states.map(state => describeEngineState(state, URL).modifier)
    expect(new Set(modifiers).size).toBe(3)
  })

  it('says online without saying offline', () => {
    const pill = describeEngineState('online', URL)
    expect(pill.modifier).toBe('online')
    expect(pill.tooltip).toContain('online')
  })

  it('says offline, and where it looked', () => {
    const pill = describeEngineState('offline', URL)
    expect(pill.modifier).toBe('offline')
    expect(pill.tooltip).toContain(URL)
  })

  it('does not claim offline before the first check has answered', () => {
    const pill = describeEngineState('unknown', URL)
    expect(pill.text).not.toContain('offline')
    expect(pill.tooltip).toContain('checking')
  })
})

describe('renderStatusPill', () => {
  it('keeps the classes Obsidian put on the status-bar item', () => {
    const el = statusBarItem()
    renderStatusPill(el as unknown as HTMLElement, 'online', URL)
    expect(el.classes.has('status-bar-item')).toBe(true)
    expect(el.classes.has(PILL_CLASS)).toBe(true)
  })

  it('carries exactly one state modifier, swapping it on a change', () => {
    const el = statusBarItem()
    renderStatusPill(el as unknown as HTMLElement, 'online', URL)
    renderStatusPill(el as unknown as HTMLElement, 'offline', URL)
    const modifiers = [...el.classes].filter(name => name.startsWith(`${PILL_CLASS}--`))
    expect(modifiers).toEqual([`${PILL_CLASS}--offline`])
  })

  it('writes the text and the tooltip', () => {
    const el = statusBarItem()
    renderStatusPill(el as unknown as HTMLElement, 'offline', URL)
    expect(el.textContent).toBe(describeEngineState('offline', URL).text)
    expect(el.attributes.get('aria-label')).toContain(URL)
  })
})
