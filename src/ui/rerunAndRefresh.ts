import { normalizePath, type App, type TFile } from 'obsidian'
import { guardWrite } from './vaultWrite'
import type { ForkedRun } from '../run/fork'
import { runHeadless } from '../run/headlessRun'
import { editsToCarry, holdNotePath, holdNoteInput, reranFrom, refreshHoldNote, rewriteProposal, type HoldHeading, type RerunEdits } from '../run/holdNote'
import { RerunProgressTracker, type OnRerunProgress } from '../run/rerunProgress'
import type { RerunReport, RerunWatch } from '../run/rerunWatch'
import type { EngineClient } from '../engine/client'
import type { LayoutModel, RunEvent, RunMeta, RunRequest } from '../engine/types'

/**
 * Firing a run from a hold note and folding the run it lands on into that note
 * — the tail "Rerun downstream" and a chat-driven `revise` share, once each has
 * its own call to make. The run of record is the one the stream names, which is
 * not always the run the call was made against (#53).
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

/** The call the hold note fires, told every event on the way so progress can be drawn. */
export type LaunchRun = (onEvent: (event: RunEvent) => void) => Promise<ForkedRun>

/**
 * How the notices name what the hold note fired. Each answers the stem; any
 * caveat — a proposal changed meanwhile, a name already taken — is added after.
 */
export interface RerunWording {
  /** The run it landed on; `forked` when the engine named a run other than the one called. */
  landed: (runId: string, forked: boolean) => string
  /** The run landed, but the note could not be folded onto it. */
  heldBack: (runId: string) => string
  /** Nothing landed: `runId` is set only once the engine had named a run, and `error` only if it said why. */
  failed: (runId: string | undefined, error: string | undefined) => string
}

const RERUN_WORDING: RerunWording = {
  landed: runId => `Reran downstream as run ${runId}`,
  heldBack: runId => `Reran as run ${runId}`,
  failed: (runId, error) => (runId ? `Rerun ${runId} failed: ${error}` : error ? `Rerun failed: ${error}` : 'Rerun produced no run'),
}

export interface RerunAndRefreshOptions {
  /** Edits the freshly re-read note before folding — a chat-driven revise's way to mark its `revise` line done. */
  beforeRefresh?: (content: string, newRunId: string) => string
  /** The run the request branched from, and the edits it was sent; decides which edits made meanwhile outlive the refresh. */
  edits: Omit<RerunEdits, 'landed'>
  onProgress?: OnRerunProgress | undefined
  /** The rerun's own words by default; a call the human asked for in other words says so here. */
  wording?: RerunWording
}

/** Runs `request`, then refreshes the hold note with the run it lands on and renames it to that run; answers that run once the note is under it. */
export function rerunAndRefresh(
  deps: RerunAndRefreshDeps,
  file: TFile,
  heading: HoldHeading,
  request: RunRequest,
  options: RerunAndRefreshOptions,
): Promise<string | undefined> {
  // A fresh run forks nothing: it carries on no run, so it can name none other than its own.
  const launch: LaunchRun = async onEvent => ({ kind: 'ran', outcome: await runHeadless(deps.engine, request, onEvent), forked: false })
  return streamIntoHold(deps, file, heading, launch, options)
}

/** The same fold, for a call that is not a fresh run: the note takes whichever run the stream names. */
export async function streamIntoHold(
  deps: RerunAndRefreshDeps,
  file: TFile,
  heading: HoldHeading,
  launch: LaunchRun,
  options: RerunAndRefreshOptions,
): Promise<string | undefined> {
  const from = [heading.runId, ...reranFrom(await deps.app.vault.cachedRead(file))]
  const report = deps.reruns.begin(from)
  try {
    return await rerunReported(deps, { file, heading, launch, options, report })
  } finally {
    report.end()
  }
}

/** One rerun under way, as `streamIntoHold` reports it. */
interface ReportedRerun {
  file: TFile
  heading: HoldHeading
  launch: LaunchRun
  options: RerunAndRefreshOptions
  report: RerunReport
}

async function rerunReported(deps: RerunAndRefreshDeps, rerun: ReportedRerun): Promise<string | undefined> {
  const { file, heading, launch, options, report } = rerun
  const { app, notify } = deps
  const beforeRefresh = options.beforeRefresh ?? (content => content)
  const wording = options.wording ?? RERUN_WORDING
  const tracker = new RerunProgressTracker()
  const streamed = await deps.withEngine(() =>
    launch(event => {
      const progress = tracker.hear(event)
      if (!progress) return
      options.onProgress?.(progress)
      report.hear(progress)
    }),
  )
  if (!streamed) return undefined
  if (streamed.kind === 'refused') {
    notify(streamed.said)
    return undefined
  }
  const outcome = streamed.outcome
  const newRunId = outcome.runId
  if (!newRunId || outcome.error) {
    notify(wording.failed(newRunId, outcome.error))
    return undefined
  }
  const landedRun = await deps.withEngine(() => fetchRun(deps.engine, newRunId))
  if (!landedRun) return undefined
  const said = wording.landed(newRunId, streamed.forked)

  const folded = await guardWrite(notify, 'the hold note', async (): Promise<{ notice: string; runId?: string }> => {
    // Read again: the human may have written in the note while the rerun went.
    const current = await app.vault.cachedRead(file)
    const kept = editsToCarry(current, { ...options.edits, landed: landedRun.layout.panels })
    if (!kept) {
      return { notice: `${wording.heldBack(newRunId)}, but proposals changed meanwhile — note left as is` }
    }
    // An edit to a proposal the rerun only replayed is put back, so it can go in the next rerun.
    const refreshed = Object.entries(kept.carried).reduce(
      (content, [name, text]) => rewriteProposal(content, name, text),
      refreshHoldNote(beforeRefresh(current, newRunId), holdNoteInput(landedRun.run, landedRun.layout.panels, heading.chainName)),
    )
    await app.vault.modify(file, refreshed)

    // Named for the run it now shows, so directing that run finds it. A run that
    // carried on in place is already that note, and has nothing to rename.
    const renamed = normalizePath(holdNotePath(newRunId))
    if (renamed !== file.path) {
      if (app.vault.getAbstractFileByPath(renamed)) {
        return { notice: `${said}, but ${renamed} already exists — note not renamed` }
      }
      await app.fileManager.renameFile(file, renamed)
    }
    const replaced = kept.replaced.length > 0 ? ` — it wrote ${kept.replaced.join(', ')} again, over your edits` : ''
    return { notice: `${said}${replaced}`, runId: newRunId }
  })
  if (folded) notify(folded.notice)
  if (folded?.runId) await report.land({ runId: folded.runId, chainName: heading.chainName, panels: landedRun.layout.panels })
  return folded?.runId
}
