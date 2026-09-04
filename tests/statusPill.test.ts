import { describe, it, expect } from 'vitest'
import { PILL_CLASS, describeEngineState, renderStatusPill } from '@/ui/statusPill'
import type { EngineState } from '@/engine/status'

const URL = 'http://localhost:3000'

/** A span the pill built inside the status-bar item. */
interface Segment {
  cls: string
  text: string
  attributes: Map<string, string>
  setAttribute(name: string, value: string): void
}

/** Just enough of an element for the pill: the status-bar item Obsidian hands over. */
function statusBarItem() {
  const classes = new Set(['status-bar-item'])
  return {
    attributes: new Map<string, string>(),
    /** Every span written into the item, in order, since the last `empty()`. */
    children: [] as Segment[],
    classList: {
      add: (name: string) => void classes.add(name),
      toggle: (name: string, on: boolean) => void (on ? classes.add(name) : classes.delete(name)),
    },
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value)
    },
    empty() {
      this.children.length = 0
    },
    createSpan({ cls = '', text = '' }: { cls?: string; text?: string }): Segment {
      const span: Segment = {
        cls,
        text,
        attributes: new Map<string, string>(),
        setAttribute(name, value) {
          this.attributes.set(name, value)
        },
      }
      this.children.push(span)
      return span
    },
    classes,
  }
}

/** What the item reads, ignoring which span each word landed in. */
function words(el: ReturnType<typeof statusBarItem>): string {
  return el.children.map(child => child.text).join('')
}

describe('describeEngineState', () => {
  it('distinguishes all three states', () => {
    const states: EngineState[] = ['unknown', 'online', 'offline']
    const modifiers = states.map(state => describeEngineState(state, URL).modifier)
    expect(new Set(modifiers).size).toBe(3)
  })

  it('gives each state an icon of its own, so the pill reads without its colour', () => {
    const states: EngineState[] = ['unknown', 'online', 'offline']
    const icons = states.map(state => describeEngineState(state, URL).icon)
    expect(new Set(icons).size).toBe(3)
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
    expect(words(el)).toBe(describeEngineState('offline', URL).text)
    expect(el.attributes.get('aria-label')).toContain(URL)
  })

  it('draws a lucide icon rather than a glyph the theme cannot restyle', () => {
    const el = statusBarItem()
    renderStatusPill(el as unknown as HTMLElement, 'online', URL)
    const icon = el.children.find(child => child.attributes.has('data-icon'))
    expect(icon?.attributes.get('data-icon')).toBe(describeEngineState('online', URL).icon)
    // Plain ASCII, so the pill is the theme's to colour and the platform's font
    // has no say in it.
    expect(words(el)).toBe('engine')
  })

  it('redraws rather than accumulating a second icon and word', () => {
    const el = statusBarItem()
    renderStatusPill(el as unknown as HTMLElement, 'online', URL)
    renderStatusPill(el as unknown as HTMLElement, 'offline', URL)
    expect(el.children).toHaveLength(2)
    expect(words(el)).toBe(describeEngineState('offline', URL).text)
  })
})
