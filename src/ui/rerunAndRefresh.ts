import { normalizePath, type App, type TFile } from 'obsidian'
import { guardWrite } from './vaultWrite'
import { runHeadless } from '../run/headlessRun'
import { holdNotePath, refreshHoldNote, thoughtsByNode, verdictPanel, type HoldHeading } from '../run/holdNote'
import type { EngineClient } from '../engine/client'
import type { AgentStartEvent, LayoutModel, LayoutPanel, RunMeta, RunRequest } from '../engine/types'

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

/** A step a rerun has started: named as its card is, or else by its agent, and whether it writes the new verdict. */
export interface RerunStep {
  name: string
  writesVerdict: boolean
}

export type OnRerunStep = (step: RerunStep) => void

export interface RerunAndRefreshHooks {
  /** Edits the freshly re-read note before folding — a chat-driven revise's way to mark its `revise` line done. */
  beforeRefresh?: (content: string, newRunId: string) => string
  /** True when the freshly re-read note's proposals no longer match what the request was built from — the refresh would discard them, so it is skipped instead. */
  proposalsStale?: (current: string) => boolean
  onStep?: OnRerunStep | undefined
}

/** Runs `request` from a run shown as `panels`, then refreshes the hold note with the run it lands on and renames it to that run; answers that run once the note is under it. */
export async function rerunAndRefresh(
  deps: RerunAndRefreshDeps,
  file: TFile,
  heading: HoldHeading,
  panels: LayoutPanel[],
  request: RunRequest,
  hooks: RerunAndRefreshHooks = {},
): Promise<string | undefined> {
  const { app, engine, notify } = deps
  const beforeRefresh = hooks.beforeRefresh ?? (content => content)
  const verdictNode = verdictPanel(panels)?.node
  const onStart = ({ agentName, nodeId }: AgentStartEvent): void => {
    const name = panels.find(panel => panel.node === nodeId)?.name ?? agentName
    hooks.onStep?.({ name, writesVerdict: nodeId === verdictNode })
  }
  const outcome = await deps.withEngine(() => runHeadless(engine, request, onStart))
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
    if (hooks.proposalsStale?.(current)) {
      return { notice: `Reran as run ${newRunId}, but proposals changed meanwhile — note left as is` }
    }
    const refreshed = refreshHoldNote(beforeRefresh(current, newRunId), {
      runId: landed.run.runId,
      chainName: heading.chainName,
      panels: landed.layout.panels,
      thoughts: thoughtsByNode(landed.run.agentOutputs),
    })
    await app.vault.modify(file, refreshed)

    // Named for the run it now shows, so directing that run finds it.
    const renamed = normalizePath(holdNotePath(newRunId))
    if (app.vault.getAbstractFileByPath(renamed)) {
      return { notice: `Reran downstream as run ${newRunId}, but ${renamed} already exists — note not renamed` }
    }
    await app.fileManager.renameFile(file, renamed)
    return { notice: `Reran downstream as run ${newRunId}`, runId: newRunId }
  })
  if (landedAt) notify(landedAt.notice)
  return landedAt?.runId
}
