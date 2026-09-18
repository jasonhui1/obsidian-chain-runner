// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { createSourceRunHeader, RERUNNING_CLASS, SOURCE_RUN_CLASS } from '@/ui/sourceRunHeader'
import { RerunWatch } from '@/run/rerunWatch'
import type { RerunProgress } from '@/run/rerunProgress'
import { SOURCE_RUN, SOURCE_RUN_DELETED } from '@/run/provenance'
import type { RunExistence } from '@/engine/types'
import type { MarkdownPostProcessorContext } from 'obsidian'

/**
 * The one line above a rendered output note: that there is exactly one, that it
 * links, and that it corrects itself when the engine says the run is gone. What
 * it says is `provenance.test.ts`; only the element is here.
 */

const RUN_ID = '2026-09-02-ab12c'
const ENGINE_URL = 'http://localhost:3000'

let asked: string[]
let answer: RunExistence
let reruns: RerunWatch

/** The frontmatter of an output note, as a post-processor is handed it. */
const context = (frontmatter: unknown): MarkdownPostProcessorContext =>
  ({ frontmatter, docId: 'd', sourcePath: 'chains/runs/r/Optimist.md' }) as MarkdownPostProcessorContext

const outputNote = { run: RUN_ID, chain: 'Relay', output: 'Survivor' }

const header = () => createSourceRunHeader({ engineUrl: () => ENGINE_URL, exists: runId => ask(runId), reruns })

function ask(runId: string): Promise<RunExistence> {
  asked.push(runId)
  return Promise.resolve(answer)
}

/** A rendered note: the container Obsidian puts the sections in. */
function rendered(sections: number): { container: HTMLElement; sections: HTMLElement[] } {
  const container = document.createElement('div')
  container.className = 'markdown-rendered'
  document.body.append(container)
  const parts = Array.from({ length: sections }, () => {
    const section = document.createElement('p')
    container.append(section)
    return section
  })
  return { container, sections: parts }
}

/** Lets the deferred insertion and the engine's answer land. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const line = (container: HTMLElement): HTMLElement | null => container.querySelector(`.${SOURCE_RUN_CLASS}`)

beforeEach(() => {
  document.body.replaceChildren()
  asked = []
  answer = 'found'
  reruns = new RerunWatch()
})

describe('the source-run line', () => {
  it('links to the run on the engine set now', async () => {
    const { container, sections } = rendered(1)
    header().processor(sections[0]!, context(outputNote))
    await settle()

    const anchor = line(container)?.querySelector('a')
    expect(anchor?.textContent).toBe(SOURCE_RUN)
    expect(anchor?.getAttribute('href')).toBe(`${ENGINE_URL}/history/${RUN_ID}`)
  })

  it('sits above the note’s own words', async () => {
    const { container, sections } = rendered(2)
    header().processor(sections[0]!, context(outputNote))
    await settle()
    expect(container.firstElementChild).toBe(line(container))
  })

  it('is one line for the note, not one per section rendered', async () => {
    const { container, sections } = rendered(3)
    const { processor } = header()
    for (const section of sections) processor(section, context(outputNote))
    await settle()

    expect(container.querySelectorAll(`.${SOURCE_RUN_CLASS}`)).toHaveLength(1)
    // And the engine is asked once, however many sections the note has.
    expect(asked).toEqual([RUN_ID])
  })

  it('says the run is deleted once the engine says it has no such run', async () => {
    answer = 'missing'
    const { container, sections } = rendered(1)
    header().processor(sections[0]!, context(outputNote))
    await settle()

    const shown = line(container)
    expect(shown?.textContent).toBe(SOURCE_RUN_DELETED)
    expect(shown?.querySelector('a')).toBeNull()
    expect(shown?.classList.contains(`${SOURCE_RUN_CLASS}--deleted`)).toBe(true)
  })

  it('leaves the link alone when the engine could not be asked', async () => {
    answer = 'unknown'
    const { container, sections } = rendered(1)
    header().processor(sections[0]!, context(outputNote))
    await settle()
    expect(line(container)?.querySelector('a')?.textContent).toBe(SOURCE_RUN)
  })

  it('asks again after an engine that could not be asked, and not after one that answered', async () => {
    const { processor } = header()
    answer = 'unknown'
    processor(rendered(1).sections[0]!, context(outputNote))
    await settle()
    answer = 'found'
    processor(rendered(1).sections[0]!, context(outputNote))
    await settle()
    processor(rendered(1).sections[0]!, context(outputNote))
    await settle()

    expect(asked).toEqual([RUN_ID, RUN_ID])
  })

  it('leaves a note that is not an output note alone', async () => {
    const { container, sections } = rendered(1)
    header().processor(sections[0]!, context({ title: 'a premise' }))
    await settle()
    expect(line(container)).toBeNull()
    expect(asked).toEqual([])
  })
})

describe('a card a rerun is writing again', () => {
  const rewriting = (step?: RerunProgress['step']): RerunProgress => ({
    verdict: false,
    proposals: ['Survivor'],
    cards: ['Survivor'],
    ...(step ? { step } : {}),
  })
  const rerunLine = (container: HTMLElement): string | undefined =>
    container.querySelector(`.${SOURCE_RUN_CLASS}-rerun`)?.textContent ?? undefined

  it('says what the rerun is doing under the source-run line, and greys the words it will replace', async () => {
    const { container, sections } = rendered(1)
    header().processor(sections[0]!, context(outputNote))
    await settle()
    reruns.begin([RUN_ID], { kind: 'edits' })!.hear(rewriting({ name: 'critic', writesVerdict: false }))

    expect(rerunLine(container)).toBe('⟳ critic is running…')
    expect(line(container)?.nextElementSibling?.textContent).toBe('⟳ critic is running…')
    expect(container.classList.contains(RERUNNING_CLASS)).toBe(true)
  })

  it('follows each step, and goes when the rerun ends', async () => {
    const { container, sections } = rendered(1)
    header().processor(sections[0]!, context(outputNote))
    await settle()
    const rerun = reruns.begin([RUN_ID], { kind: 'edits' })!
    rerun.hear(rewriting())
    expect(rerunLine(container)).toBe('⟳ Starting the rerun…')
    rerun.hear(rewriting({ name: 'Survivor', writesVerdict: true }))
    expect(rerunLine(container)).toBe('⟳ Writing a new verdict…')
    rerun.end()

    expect(rerunLine(container)).toBe('')
    expect(container.classList.contains(RERUNNING_CLASS)).toBe(false)
  })

  it('shows a rerun already going when the card is rendered', async () => {
    reruns.begin([RUN_ID], { kind: 'edits' })!.hear(rewriting())
    const { container, sections } = rendered(1)
    header().processor(sections[0]!, context(outputNote))
    await settle()
    expect(rerunLine(container)).toBe('⟳ Starting the rerun…')
  })

  it('leaves a card the rerun only replays as it is', async () => {
    const { container, sections } = rendered(1)
    header().processor(sections[0]!, context({ ...outputNote, output: 'Optimist' }))
    await settle()
    reruns.begin([RUN_ID], { kind: 'edits' })!.hear(rewriting())
    expect(rerunLine(container)).toBe('')
    expect(container.classList.contains(RERUNNING_CLASS)).toBe(false)
  })

  it('follows the note a rendering shows now, when the card is pointed at another', async () => {
    const { processor } = header()
    const { container, sections } = rendered(1)
    processor(sections[0]!, context({ ...outputNote, run: 'earlier' }))
    await settle()
    processor(sections[0]!, context(outputNote))
    await settle()
    reruns.begin([RUN_ID], { kind: 'edits' })!.hear(rewriting())
    expect(container.querySelectorAll(`.${SOURCE_RUN_CLASS}`)).toHaveLength(1)
    expect(rerunLine(container)).toBe('⟳ Starting the rerun…')
    expect(line(container)?.querySelector('a')?.getAttribute('href')).toBe(`${ENGINE_URL}/history/${RUN_ID}`)
  })

  it('takes over a header another load of the plugin drew', async () => {
    const { container, sections } = rendered(1)
    const stale = document.createElement('div')
    stale.className = SOURCE_RUN_CLASS
    container.prepend(stale)
    header().processor(sections[0]!, context(outputNote))
    await settle()
    reruns.begin([RUN_ID], { kind: 'edits' })!.hear(rewriting())
    expect(container.querySelectorAll(`.${SOURCE_RUN_CLASS}`)).toHaveLength(1)
    expect(rerunLine(container)).toBe('⟳ Starting the rerun…')
  })

  it('lets go of the watch once stopped', async () => {
    const shown = header()
    const { container, sections } = rendered(1)
    shown.processor(sections[0]!, context(outputNote))
    await settle()
    shown.stop()
    reruns.begin([RUN_ID], { kind: 'edits' })!.hear(rewriting())
    expect(rerunLine(container)).toBe('')
  })
})
