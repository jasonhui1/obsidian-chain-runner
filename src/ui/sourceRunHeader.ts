import type { MarkdownPostProcessor } from 'obsidian'
import { resolveSourceRun, sourceNote, sourceRunLabel, sourceRunLink, type SourceRun } from '../run/provenance'
import { rerunDoing } from '../run/rerunProgress'
import type { RerunWatch } from '../run/rerunWatch'
import type { RunExistence } from '../engine/types'

/**
 * The line an output note carries at the top of every rendering of it — in an
 * embeddable on a drawing, and in the note's own tab. What it says is decided in
 * `src/run/provenance.ts`; only the element is here.
 */

export const SOURCE_RUN_CLASS = 'chain-runner-source-run'
/** On the rendering while a rerun writes its card again, which greys the words it will replace. */
export const RERUNNING_CLASS = 'chain-runner-rerunning'

export interface SourceRunHeaderDeps {
  engineUrl: () => string
  exists: (runId: string) => Promise<RunExistence>
  reruns: Pick<RerunWatch, 'rewriting' | 'onChange'>
}

/**
 * Draws the link at once and corrects it when the engine answers: a note renders
 * on every write of the run that is still filling it, and waiting on the network
 * first would hold each of those renders up.
 */
export function createSourceRunHeader(deps: SourceRunHeaderDeps): MarkdownPostProcessor {
  const exists = remembering(deps)
  return (el, ctx) => {
    const note = sourceNote(ctx.frontmatter)
    if (!note) return
    const { runId } = note
    // The header is the note's, not this section's, and a post-processor runs
    // per section against an element not yet in the document — so both the
    // container and the one-header rule wait for the rendering to land.
    setTimeout(() => {
      const header = headerFor(el)
      if (!header) return
      const engineUrl = deps.engineUrl()
      writeSourceRun(header, sourceRunLink(engineUrl, runId))
      void resolveSourceRun({ runId, engineUrl, exists }).then(source => writeSourceRun(header, source))
      followReruns(header, runId, note.output, deps.reruns)
    })
  }
}

/** A line under the header saying what a rerun writing this card again is doing; empty while none is. */
function followReruns(header: HTMLElement, runId: string, card: string, reruns: SourceRunHeaderDeps['reruns']): void {
  const line = header.ownerDocument.createElement('div')
  line.className = `${SOURCE_RUN_CLASS}-rerun`
  header.after(line)
  const container = header.parentElement
  const show = (): void => {
    const rerun = reruns.rewriting(runId, card)
    line.textContent = rerun ? rerunDoing(rerun.step) : ''
    container?.classList.toggle(RERUNNING_CLASS, rerun !== undefined)
  }
  show()
  // Tied to the line, not a section: the header outlives the section that made it.
  const stop = reruns.onChange(() => (line.isConnected ? show() : stop()))
}

/** The note's own header element, made if this is the first section to ask for it. */
function headerFor(el: HTMLElement): HTMLElement | undefined {
  const container = el.closest('.markdown-rendered, .markdown-preview-view') ?? el
  if (container.querySelector(`.${SOURCE_RUN_CLASS}`)) return undefined
  const header = container.ownerDocument.createElement('div')
  header.className = SOURCE_RUN_CLASS
  container.prepend(header)
  return header
}

/** Writes the header's one line: a link to the run, or the words that it is gone. */
export function writeSourceRun(header: HTMLElement, source: SourceRun): void {
  const label = sourceRunLabel(source)
  header.classList.toggle(`${SOURCE_RUN_CLASS}--deleted`, source.kind === 'deleted')
  header.replaceChildren()
  if (source.kind !== 'run' || !source.url) {
    header.textContent = label
    return
  }
  const anchor = header.ownerDocument.createElement('a')
  anchor.href = source.url
  anchor.textContent = label
  anchor.setAttribute('aria-label', `${source.runId} on the engine`)
  header.append(anchor)
}

/**
 * One question per run, so a note rewritten line by line during its own run does
 * not ask the engine again per repaint. An engine that could not be asked is not
 * remembered, so the next rendering asks again.
 */
function remembering(deps: SourceRunHeaderDeps): (runId: string) => Promise<RunExistence> {
  const asked = new Map<string, Promise<RunExistence>>()
  return runId => {
    const key = `${deps.engineUrl()}\n${runId}`
    const known = asked.get(key)
    if (known) return known
    const asking = deps.exists(runId).then(
      answer => {
        if (answer === 'unknown') asked.delete(key)
        return answer
      },
      error => {
        asked.delete(key)
        throw error
      },
    )
    asked.set(key, asking)
    return asking
  }
}
