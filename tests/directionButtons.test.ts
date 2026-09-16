// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { createDirectionButtons, PROPOSAL_BUTTONS_CLASS, PROPOSAL_BUTTON_CLASS } from '@/ui/directionButtons'
import type { App, TFile } from 'obsidian'
import { TFile as StubFile, lastModal, resetModals } from './obsidian'
import type { MarkdownPostProcessorContext } from 'obsidian'

/**
 * The verb buttons next to each proposal: that a hold note gets one row per
 * proposal and a note that isn't one gets none, and that pressing a button
 * appends the right line — COMBINE only once a second proposal is picked.
 * What the line says is `holdNote.test.ts`; only the buttons are here.
 */

const HOLD_PATH = 'Maestro/holds/2026-09-15-Ab3dE1.md'

let notes: Record<string, string>
let notices: string[]

function file(path: string): TFile {
  const stub = new StubFile()
  stub.path = path
  stub.extension = 'md'
  return stub as unknown as TFile
}

function makeApp(): App {
  return {
    vault: {
      getAbstractFileByPath: (path: string) => (notes[path] !== undefined ? file(path) : null),
      cachedRead: (target: { path: string }) => Promise.resolve(notes[target.path] ?? ''),
      modify: (target: { path: string }, content: string) => {
        notes[target.path] = content
        return Promise.resolve()
      },
    },
  } as unknown as App
}

const context = (): MarkdownPostProcessorContext => ({ sourcePath: HOLD_PATH, docId: 'd' }) as MarkdownPostProcessorContext

const buttons = () => createDirectionButtons({ app: makeApp(), notify: message => void notices.push(message) })

/** A rendered hold note: a title, one heading per proposal, each its own section. */
function rendered(names: string[], title = 'Hold: run 2026-09-15-Ab3dE1 · creative-director'): { container: HTMLElement; sections: HTMLElement[] } {
  const container = document.createElement('div')
  container.className = 'markdown-rendered'
  document.body.append(container)

  const h1 = document.createElement('h1')
  h1.textContent = title
  container.append(h1)

  const sections = names.map(name => {
    const section = document.createElement('div')
    const h3 = document.createElement('h3')
    h3.textContent = name
    section.append(h3)
    container.append(section)
    return section
  })
  return { container, sections }
}

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const rows = (container: HTMLElement): NodeListOf<Element> => container.querySelectorAll(`.${PROPOSAL_BUTTONS_CLASS}`)

function press(row: Element, verb: string): void {
  const button = Array.from(row.querySelectorAll(`.${PROPOSAL_BUTTON_CLASS}`)).find(candidate => candidate.textContent === verb)
  if (!button) throw new Error(`no ${verb} button`)
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

beforeEach(() => {
  document.body.replaceChildren()
  notes = { [HOLD_PATH]: '## Direction\nKEEP:\n\n## Conversation\n' }
  notices = []
  resetModals()
})

describe('button rows', () => {
  it('draws one row per proposal, with a button for each verb but CHANGE', async () => {
    const { container, sections } = rendered(['character-director', 'gameplay-director'])
    const processor = buttons()
    for (const section of sections) processor(section, context())
    await settle()

    expect(rows(container)).toHaveLength(2)
    const labels = Array.from(rows(container)[0]!.querySelectorAll(`.${PROPOSAL_BUTTON_CLASS}`)).map(b => b.textContent)
    expect(labels).toEqual(['KEEP', 'KILL', 'PUSH', 'REDUCE', 'MUTATE', 'COMBINE'])
  })

  it('sits right after the proposal it belongs to', async () => {
    const { sections } = rendered(['character-director'])
    buttons()(sections[0]!, context())
    await settle()
    expect(sections[0]!.querySelector('h3')?.nextElementSibling?.className).toBe(PROPOSAL_BUTTONS_CLASS)
  })

  it('draws nothing for a note that is not a hold note', async () => {
    const { container, sections } = rendered(['a heading'], 'Just some words')
    buttons()(sections[0]!, context())
    await settle()
    expect(rows(container)).toHaveLength(0)
  })

  it('does not draw a second row over one already there', async () => {
    const { container, sections } = rendered(['character-director'])
    const processor = buttons()
    processor(sections[0]!, context())
    await settle()
    processor(sections[0]!, context())
    await settle()
    expect(rows(container)).toHaveLength(1)
  })
})

describe('pressing a verb', () => {
  it('appends a correctly attributed line', async () => {
    const { sections } = rendered(['character-director', 'gameplay-director'])
    const processor = buttons()
    for (const section of sections) processor(section, context())
    await settle()

    press(rows(document.body)[0]!, 'KEEP')
    await settle()
    expect(notes[HOLD_PATH]).toContain('KEEP: character-director')
  })

  it('leaves a note that is not the note the button is drawn in alone', async () => {
    notes['some/other.md'] = '## Direction\n\n## Conversation\n'
    const { sections } = rendered(['character-director'])
    buttons()(sections[0]!, context())
    await settle()

    press(rows(document.body)[0]!, 'KILL')
    await settle()
    expect(notes['some/other.md']).toBe('## Direction\n\n## Conversation\n')
  })
})

describe('pressing COMBINE', () => {
  it('asks for a second proposal before appending anything', async () => {
    const { sections } = rendered(['character-director', 'gameplay-director'])
    const processor = buttons()
    for (const section of sections) processor(section, context())
    await settle()

    press(rows(document.body)[0]!, 'COMBINE')
    expect(lastModal()?.placeholder).toBe('Combine with which proposal?')
    expect(notes[HOLD_PATH]).not.toContain('COMBINE')
  })

  it('offers every other proposal, not the one the button is on', async () => {
    const { sections } = rendered(['character-director', 'gameplay-director', 'world-director'])
    const processor = buttons()
    for (const section of sections) processor(section, context())
    await settle()

    press(rows(document.body)[0]!, 'COMBINE')
    expect(() => lastModal()?.choose(2)).toThrow()
    lastModal()?.choose(1)
    await settle()
    expect(notes[HOLD_PATH]).toContain('COMBINE: character-director + world-director')
  })
})
