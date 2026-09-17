import { normalizePath, type App, type TFile } from 'obsidian'
import { guardWrite } from './vaultWrite'
import { runHeadless } from '../run/headlessRun'
import { editsToCarry, holdNotePath, holdNoteInput, reranFrom, refreshHoldNote, rewriteProposal, type HoldHeading, type RerunEdits } from '../run/holdNote'
import { RerunProgressTracker, type OnRerunProgress } from '../run/rerunProgress'
import type { RerunReport, RerunWatch } from '../run/rerunWatch'
import type { EngineClient } from '../engine/client'
import type { LayoutModel, RunMeta, RunRequest } from '../engine/types'

/**
 * Firing a rerun-downstream request and folding the run it lands on into the
 * hold note — the tail both "Rerun downstream" and a chat-driven `revise`
 * share, once each has its own `branchOutputs`.
 */

export interface RerunAndRefreshDeps {
  app: App
  engine: EngineClient
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  notify: (message: string) => void
  /** Hears every rerun, so the drawing follows one no panel started. */
  reruns: RerunWatch
}

export interface FetchedRun {
  run: RunMeta
  layout: LayoutModel
}

export async function fetchRun(engine: EngineClient, runId: string): Promise<FetchedRun> {
  const [run, layout] = await Promise.all([engine.getRun(runId), engine.getLayout(runId)])
  return { run, layout }
}

export interface RerunAndRefreshOptions {
  /** Edits the freshly re-read note before folding — a chat-driven revise's way to mark its `revise` line done. */
  beforeRefresh?: (content: string, newRunId: string) => string
  /** The run the request branched from, and the edits it was sent; decides which edits made meanwhile outlive the refresh. */
  edits: Omit<RerunEdits, 'landed'>
  onProgress?: OnRerunProgress | undefined
}

/** Runs `request`, then refreshes the hold note with the run it lands on and renames it to that run; answers that run once the note is under it. */
export async function rerunAndRefresh(
  deps: RerunAndRefreshDeps,
  file: TFile,
  heading: HoldHeading,
  request: RunRequest,
  options: RerunAndRefreshOptions,
): Promise<string | undefined> {
  const from = [heading.runId, ...reranFrom(await deps.app.vault.cachedRead(file))]
  const report = deps.reruns.begin(from)
  try {
    return await rerunReported(deps, { file, heading, request, options, report })
  } finally {
    report.end()
  }
}

/** One rerun under way, as `rerunAndRefresh` reports it. */
interface ReportedRerun {
  file: TFile
  heading: HoldHeading
  request: RunRequest
  options: RerunAndRefreshOptions
  report: RerunReport
}

async function rerunReported(deps: RerunAndRefreshDeps, rerun: ReportedRerun): Promise<string | undefined> {
  const { file, heading, request, options, report } = rerun
  const { app, engine, notify } = deps
  const beforeRefresh = options.beforeRefresh ?? (content => content)
  const tracker = new RerunProgressTracker()
  const outcome = await deps.withEngine(() =>
    runHeadless(engine, request, event => {
      const progress = tracker.hear(event)
      if (!progress) return
      options.onProgress?.(progress)
      report.hear(progress)
    }),
  )
  if (!outcome) return undefined
  const newRunId = outcome.runId
  if (!newRunId) {
    notify(outcome.error ? `Rerun failed: ${outcome.error}` : 'Rerun produced no run')
    return undefined
  }
  if (outcome.error) {
    notify(`Rerun ${newRunId} failed: ${outcome.error}`)
    return undefined
  }
  const landed = await deps.withEngine(() => fetchRun(engine, newRunId))
  if (!landed) return undefined

  const landedAt = await guardWrite(notify, 'the hold note', async (): Promise<{ notice: string; runId?: string }> => {
    // Read again: the human may have written in the note while the rerun went.
    const current = await app.vault.cachedRead(file)
    const kept = editsToCarry(current, { ...options.edits, landed: landed.layout.panels })
    if (!kept) {
      return { notice: `Reran as run ${newRunId}, but proposals changed meanwhile — note left as is` }
    }
    // An edit to a proposal the rerun only replayed is put back, so it can go in the next rerun.
    const refreshed = Object.entries(kept.carried).reduce(
      (content, [name, text]) => rewriteProposal(content, name, text),
      refreshHoldNote(beforeRefresh(current, newRunId), holdNoteInput(landed.run, landed.layout.panels, heading.chainName)),
    )
    await app.vault.modify(file, refreshed)

    // Named for the run it now shows, so directing that run finds it.
    const renamed = normalizePath(holdNotePath(newRunId))
    if (app.vault.getAbstractFileByPath(renamed)) {
      return { notice: `Reran downstream as run ${newRunId}, but ${renamed} already exists — note not renamed` }
    }
    await app.fileManager.renameFile(file, renamed)
    const replaced = kept.replaced.length > 0 ? ` — it wrote ${kept.replaced.join(', ')} again, over your edits` : ''
    return { notice: `Reran downstream as run ${newRunId}${replaced}`, runId: newRunId }
  })
  if (landedAt) notify(landedAt.notice)
  if (landedAt?.runId) await report.land({ runId: landedAt.runId, chainName: heading.chainName, panels: landed.layout.panels })
  return landedAt?.runId
}
