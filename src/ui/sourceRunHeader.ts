import type { MarkdownPostProcessor } from 'obsidian'
import {
  resolveSourceRun,
  runViewUrl,
  sourceRunId,
  sourceRunLabel,
  type RunExistence,
  type SourceRun,
} from '../run/provenance'

/**
 * The line an output note carries at the top of every rendering of it — in an
 * embeddable on a drawing, and in the note's own tab. What it says is decided in
 * `src/run/provenance.ts`; only the element is here.
 */

export const SOURCE_RUN_CLASS = 'chain-runner-source-run'

export interface SourceRunHeaderDeps {
  engineUrl: () => string
  exists: (runId: string) => Promise<RunExistence>
}

/**
 * Draws the link at once and corrects it when the engine answers: a note renders
 * on every keystroke of the run that is writing it, and waiting on the network
 * first would hold each of those renders up.
 */
export function createSourceRunHeader(deps: SourceRunHeaderDeps): MarkdownPostProcessor {
  const exists = remembering(deps)
  return (el, ctx) => {
    const runId = sourceRunId(ctx.frontmatter)
    if (!runId) return
    const container = el.closest('.markdown-rendered, .markdown-preview-view') ?? el
    // A post-processor runs per section of the note; the header is the note's.
    if (container.querySelector(`.${SOURCE_RUN_CLASS}`)) return

    const engineUrl = deps.engineUrl()
    const header = container.ownerDocument.createElement('div')
    header.className = SOURCE_RUN_CLASS
    container.prepend(header)
    const url = runViewUrl(engineUrl, runId)
    writeSourceRun(header, { kind: 'run', runId, ...(url ? { url } : {}) })

    void resolveSourceRun({ runId, engineUrl, exists }).then(source => {
      if (header.isConnected) writeSourceRun(header, source)
    })
  }
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
