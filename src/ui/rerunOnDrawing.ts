import type { RerunSurface } from './excalidraw'
import { onDrawing } from './onDrawing'
import type { OutputNotes } from './outputNotes'
import { fillLiveOutputs, type LiveOutput } from './liveOutputs'
import { applyRunEvent, emptyRunState, type RunState } from '../run/session'
import { lineCount } from '../run/panels'
import { runIdOf, type LayoutPanel } from '../engine/types'
import type { PickStream, RerunLanding } from '../run/rerunWatch'

/**
 * A landed rerun, followed on the drawing: each card of the old run is pointed
 * at a note filed under the new one, so the old notes stay the old run's record.
 * Only drawings open now can be reached.
 */

export interface RerunOnDrawingDeps {
  surface: RerunSurface
  notes: Pick<OutputNotes, 'write' | 'open'>
  notify: (message: string) => void
}

export class RerunOnDrawing {
  private readonly picks = new Map<string, {
    state: RunState
    outputs: LiveOutput<{ index: number; panel: LayoutPanel }>[]
    counts: string
  }>()

  constructor(private readonly deps: RerunOnDrawingDeps) {}

  /** A resumed run's notes and cards start at run_start, then fill a line at a time. */
  async streamPick(stream: PickStream): Promise<void> {
    try {
      const runId = runIdOf(stream.event)
      if (runId && runId !== stream.sourceRunId) return
      let live = this.picks.get(stream.sourceRunId)
      if (!live) {
        if (!runId) return
        const outputs: LiveOutput<{ index: number; panel: LayoutPanel }>[] = []
        for (const index of stream.pick.pending) {
          const panel = stream.sourcePanels[index]
          if (!panel) continue
          const note = await this.deps.notes.open(panel, { runId, chainName: stream.chainName })
          if (note) outputs.push({ index, place: { index, panel }, note, written: { text: '', state: 'pending' } })
        }
        live = { state: emptyRunState(), outputs, counts: '' }
        this.picks.set(stream.sourceRunId, live)
        const landing = { from: [stream.sourceRunId], runId, chainName: stream.chainName, panels: stream.sourcePanels, pick: stream.pick }
        const placed = outputs.map(one => ({ index: one.index, panel: one.place.panel, notePath: one.note.path }))
        for (const view of this.deps.surface.openViews()) {
          await onDrawing(() => this.deps.surface.on(view).placePickRow(landing, placed), this.deps.notify)
        }
      }
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
          await onDrawing(() => this.deps.surface.on(view).updatePickCounts({
            from: [stream.sourceRunId], runId: stream.sourceRunId, chainName: stream.chainName,
            panels: current, pick: stream.pick,
          }), this.deps.notify)
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
    const { surface, notify } = this.deps
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
    for (const view of surface.openViews()) {
      if (landing.pick) {
        await onDrawing(() => surface.on(view).placePickRow(landing, pickOutputs), notify)
        await onDrawing(() => surface.on(view).updatePickCounts(landing), notify)
      } else {
        await onDrawing(() => surface.on(view).followRerun(landing.from, landing.runId, noteFor), notify)
      }
    }
  }

  /** The new run's note for `output`; `undefined` when that run has no such output, or the vault refused it. */
  private async file(landing: RerunLanding, output: string): Promise<string | undefined> {
    const panel = landing.panels.find(one => one.name === output)
    return panel && this.deps.notes.write(panel, { runId: landing.runId, chainName: landing.chainName })
  }
}
