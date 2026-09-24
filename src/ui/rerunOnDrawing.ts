import type { DrawingView, RerunSurface } from './excalidraw'
import { onDrawing } from './onDrawing'
import type { OutputNotes } from './outputNotes'
import { fillLiveOutputs, type LiveOutput } from './liveOutputs'
import { applyRunEvent, emptyRunState, type RunState } from '../run/session'
import { lineCount } from '../run/panels'
import type { LayoutPanel } from '../engine/types'
import type { PickStream, RerunLanding } from '../run/rerunWatch'
import { runName, runNameFromMeta } from '../run/runName'
import { pickPanelIndexes } from '../run/pickPanels'
import type { EngineClient } from '../engine/client'
import { waitingHolds, type HoldRecord, type RunMeta } from '../engine/types'

/** Live pick rows and rerun cards on open drawings; later opens rebuild missing pick rows. */

export interface RerunOnDrawingDeps {
  surface: RerunSurface
  notes: Pick<OutputNotes, 'write' | 'open'>
  notify: (message: string) => void
  engine?: Pick<EngineClient, 'getRun' | 'listForks' | 'getLayout'>
}

export class RerunOnDrawing {
  private readonly drawingWrites = new Map<DrawingView, Promise<void>>()
  private readonly picks = new Map<string, {
    runId: string
    state: RunState
    outputs: LiveOutput<{ index: number; panel: LayoutPanel }>[]
    counts: string
  }>()

  constructor(private readonly deps: RerunOnDrawingDeps) {}

  private async writeDrawing(view: DrawingView, write: () => Promise<unknown>): Promise<void> {
    const previous = this.drawingWrites.get(view) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(async () => { await onDrawing(write, this.deps.notify) })
    this.drawingWrites.set(view, current)
    try { await current } finally {
      if (this.drawingWrites.get(view) === current) this.drawingWrites.delete(view)
    }
  }

  /** Rebuild rows made while the drawing was closed from the engine's run records. */
  async rebuild(view: DrawingView): Promise<void> {
    const { engine, surface, notes, notify } = this.deps
    if (!engine || surface.unavailable()) return
    let sources: ReturnType<ReturnType<RerunSurface['on']>['pickSources']>
    try { sources = surface.on(view).pickSources() } catch { return }
    for (const source of sources) {
      try {
        const origin = await engine.getRun(source.runId)
        const forks = await engine.listForks(source.runId)
        const runs = [origin, ...forks.filter(run =>
          run.branchedFromRunId === source.runId && run.branchedFromNode === source.nodeId,
        )]
        for (const run of runs) {
          if (source.placed.includes(run.runId) || run.status === 'running') continue
          const heading = chosenAt(run, source.nodeId)
          if (!heading) continue
          const layout = await engine.getLayout(run.runId)
          const pending = source.outputIndexes.length > 0 ? source.outputIndexes : pickPanelIndexes(origin, source.nodeId, layout.panels)
          if (pending.length === 0) continue
          const outputs: { index: number; panel: LayoutPanel; notePath: string }[] = []
          for (const index of pending) {
            const panel = layout.panels[index]
            if (!panel) continue
            const notePath = await notes.write(panel, { runId: run.runId, chainName: run.chainName })
            if (notePath) outputs.push({ index, panel, notePath })
          }
          const landing = {
            from: [source.runId], runId: run.runId, chainName: run.chainName,
            panels: layout.panels, pick: { nodeId: source.nodeId, heading, pending },
          }
          await this.writeDrawing(view, () => surface.on(view).placePickRow(landing, outputs))
          const held = heldInRow(run, landing.pick, layout.panels)
          if (held) await this.writeDrawing(view, () => surface.on(view).placeRowHold(landing, held.hold, held.pending))
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Could not rebuild pick rows')
      }
    }
  }

  /** A resumed run's notes and cards start at run_start, then fill a line at a time. */
  async streamPick(stream: PickStream): Promise<void> {
    try {
      const runId = stream.runId
      let live = this.picks.get(runId)
      if (!live) {
        if (!runId) return
        const outputs: LiveOutput<{ index: number; panel: LayoutPanel }>[] = []
        for (const index of stream.pick.pending) {
          const panel = stream.sourcePanels[index]
          if (!panel) continue
          const note = await this.deps.notes.open(panel, { runId, chainName: stream.chainName })
          if (note) outputs.push({ index, place: { index, panel }, note, written: { text: '', state: 'pending' } })
        }
        live = { runId, state: emptyRunState(), outputs, counts: '' }
        this.picks.set(runId, live)
        const landing = { from: [stream.sourceRunId], runId, chainName: stream.chainName, panels: stream.sourcePanels, pick: stream.pick }
        const placed = outputs.map(one => ({ index: one.index, panel: one.place.panel, notePath: one.note.path }))
        for (const view of this.deps.surface.openViews()) {
          await this.writeDrawing(view, () => this.deps.surface.on(view).placePickRow(landing, placed))
        }
      }
      if (runId && runId !== live.runId) return
      live.state = applyRunEvent(live.state, stream.event)
      const panels = live.state.layout?.panels ?? stream.sourcePanels
      await fillLiveOutputs(live.outputs, {
        kind: 'timeline',
        panels: panels.map(panel => panel.state === 'pending'
          ? { ...panel, streaming: live.state.nodes.streaming[panel.node] }
          : panel),
      }, false)
      const byIndex = new Map(live.outputs.map(one => [one.index, lineCount(one.written.text)]))
      const counts = [...byIndex].map(([index, lines]) => `${index}:${lines}`).join(',')
      if (counts !== live.counts) {
        live.counts = counts
        const current = panels.map((panel, index) => ({
          ...panel,
          lines: byIndex.get(index) ?? panel.lines,
        }))
        for (const view of this.deps.surface.openViews()) {
          await this.writeDrawing(view, () => this.deps.surface.on(view).updatePickCounts({
            from: [stream.sourceRunId], runId: live.runId, chainName: stream.chainName,
            panels: current, pick: stream.pick,
          }))
        }
      }
    } catch (error) {
      this.deps.notify(error instanceof Error ? error.message : 'Could not fill the pick row')
    }
  }

  /** Never throws: the hold has already moved on. */
  async land(landing: RerunLanding): Promise<void> {
    try {
      await this.landFiles(landing)
    } catch (error) {
      this.deps.notify(error instanceof Error ? error.message : 'Could not file the resumed run')
    }
  }

  private async landFiles(landing: RerunLanding): Promise<void> {
    const { surface } = this.deps
    const live = landing.pick ? this.picks.get(landing.runId) : undefined
    if (live) {
      await fillLiveOutputs(live.outputs, { kind: 'timeline', panels: landing.panels }, true)
      this.picks.delete(landing.runId)
    }
    const filed = new Map<string, Promise<string | undefined>>()
    const noteFor = (output: string): Promise<string | undefined> => {
      if (!filed.has(output)) {
        const opened = live?.outputs.find(one => one.place.panel.name === output)
        filed.set(output, opened ? Promise.resolve(opened.note.path) : this.file(landing, output))
      }
      return filed.get(output) as Promise<string | undefined>
    }
    const pickOutputs: { index: number; panel: LayoutPanel; notePath: string }[] = []
    if (landing.pick) {
      for (const index of landing.pick.pending) {
        const panel = landing.panels[index]
        if (!panel) continue
        const opened = live?.outputs.find(one => one.index === index)
        const notePath = opened?.note.path ?? await this.deps.notes.write(panel, { runId: landing.runId, chainName: landing.chainName })
        if (notePath) pickOutputs.push({ index, panel, notePath })
      }
    } else if (landing.from.includes(landing.runId)) {
      for (const panel of landing.panels) await noteFor(panel.name)
    }
    if (surface.unavailable()) return
    const run = await this.deps.engine?.getRun(landing.runId).catch(() => undefined)
    const toTitle = run ? runNameFromMeta(run) : runName({ chainName: landing.chainName, startTime: Date.now() })
    const held = landing.pick && run ? heldInRow(run, landing.pick, landing.panels) : undefined
    for (const view of surface.openViews()) {
      if (landing.pick) {
        await this.writeDrawing(view, () => surface.on(view).placePickRow(landing, pickOutputs))
        await this.writeDrawing(view, () => surface.on(view).updatePickCounts(landing))
        if (held) await this.writeDrawing(view, () => surface.on(view).placeRowHold(landing, held.hold, held.pending))
      } else {
        await this.writeDrawing(view, () => surface.on(view).followRerun(landing.from, landing.runId, noteFor, toTitle))
      }
    }
  }

  /** The new run's note for `output`; `undefined` when that run has no such output, or the vault refused it. */
  private async file(landing: RerunLanding, output: string): Promise<string | undefined> {
    const panel = landing.panels.find(one => one.name === output)
    return panel && this.deps.notes.write(panel, { runId: landing.runId, chainName: landing.chainName })
  }
}

function chosenAt(run: RunMeta, nodeId: string): string | undefined {
  const hold = [...(run.holds ?? [])].reverse().find(one => one.nodeId === nodeId && (one.chosen || one.custom))
  return hold?.chosen ?? (hold?.custom ? 'Your own words' : undefined)
}

/** The hold a picked run stopped at further on, and the row's panels it has not reached. */
function heldInRow(run: RunMeta, pick: { nodeId: string; pending: readonly number[] }, panels: readonly LayoutPanel[]): { hold: HoldRecord; pending: number[] } | undefined {
  if (run.status !== 'waiting') return undefined
  const hold = waitingHolds(run.holds).filter(one => one.nodeId !== pick.nodeId).at(-1)
  if (!hold) return undefined
  const after = new Set(pickPanelIndexes(run, hold.nodeId, panels))
  return { hold, pending: pick.pending.filter(index => after.has(index) || panels[index]?.node === hold.nodeId) }
}
