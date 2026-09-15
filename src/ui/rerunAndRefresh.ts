import type { App, TFile } from 'obsidian'
import { guardWrite } from './vaultWrite'
import { runHeadless } from '../run/headlessRun'
import { refreshHoldNote, thoughtsByNode } from '../run/holdNote'
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
}

export interface FetchedRun {
  run: RunMeta
  layout: LayoutModel
}

export async function fetchRun(engine: EngineClient, runId: string): Promise<FetchedRun> {
  const [run, layout] = await Promise.all([engine.getRun(runId), engine.getLayout(runId)])
  return { run, layout }
}

/**
 * Runs `request`, then refreshes the hold note with the run it lands on.
 * `beforeRefresh` edits the freshly re-read note first — the one hook a
 * chat-driven revise needs, to mark its `revise` line done before folding.
 */
export async function rerunAndRefresh(
  deps: RerunAndRefreshDeps,
  file: TFile,
  heading: { runId: string; chainName: string },
  request: RunRequest,
  beforeRefresh: (content: string, newRunId: string) => string = content => content,
): Promise<void> {
  const { app, engine, notify } = deps
  const outcome = await deps.withEngine(() => runHeadless(engine, request))
  if (!outcome) return
  const newRunId = outcome.runId
  if (!newRunId) {
    notify(outcome.error ? `Rerun failed: ${outcome.error}` : 'Rerun produced no run')
    return
  }
  if (outcome.error) {
    notify(`Rerun ${newRunId} failed: ${outcome.error}`)
    return
  }
  const landed = await deps.withEngine(() => fetchRun(engine, newRunId))
  if (!landed) return

  const wrote = await guardWrite(notify, 'the hold note', async () => {
    // Read again: the human may have written in the note while the rerun went.
    const current = await app.vault.cachedRead(file)
    const refreshed = refreshHoldNote(beforeRefresh(current, newRunId), {
      runId: landed.run.runId,
      chainName: heading.chainName,
      panels: landed.layout.panels,
      thoughts: thoughtsByNode(landed.run.agentOutputs),
    })
    await app.vault.modify(file, refreshed)
    return true
  })
  if (wrote) notify(`Reran downstream as run ${landed.run.runId}`)
}
