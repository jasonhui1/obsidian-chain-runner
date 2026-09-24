import { holdStamp, type HoldStamp } from './holdColumn'
import type { DrawingView, SelectionSurface } from './excalidraw'
import type { DrawingPick, Holds } from './holds'
import { UNREACHABLE_DRAWING } from './onDrawing'
export const TYPE_FIRST = 'Type something first'

/** A Continue line uses the same two-click drill-in as a node's Run line. */
const DOUBLE_CLICK_MS = 1000

export interface ContinueFromDrawingDeps {
  surface: SelectionSurface
  holds: Pick<Holds, 'resume' | 'read'>
  notify: (message: string) => void
  now: () => number
  refreshColumn: (runId: string, nodeId: string, view: DrawingView) => Promise<void>
}

export class ContinueFromDrawing {
  private last: { stamp: HoldStamp; view: DrawingView; at: number } | undefined
  private doubleAt: number | undefined
  private going = new Set<string>()
  private startedAt = new Map<string, number>()

  constructor(private readonly deps: ContinueFromDrawingDeps) {}

  handleSelection(element: { customData?: unknown }, view: DrawingView): void {
    const stamp = holdStamp(element)
    if (stamp?.role !== 'continue') return
    this.last = { stamp, view, at: this.deps.now() }
    if (this.doubleAt !== undefined && this.deps.now() - this.doubleAt <= DOUBLE_CLICK_MS) {
      this.doubleAt = undefined
      this.start(stamp, view)
      return
    }
  }

  handleDoubleClick(): void {
    const last = this.last
    if (last && this.deps.now() - last.at <= DOUBLE_CLICK_MS) {
      this.last = undefined
      this.start(last.stamp, last.view)
      return
    }
    try {
      const selected = this.deps.surface.on?.(last?.view).selectedContinue()
      const stamp = selected && holdStamp(selected)
      if (stamp?.role === 'continue' && last?.view) {
        this.start(stamp, last.view)
        return
      }
    } catch {
      // A double-click elsewhere in the workspace has no drawing to read.
    }
    this.doubleAt = this.deps.now()
  }

  handleTextEdit(element: { customData?: unknown }, view: DrawingView): void {
    const stamp = holdStamp(element)
    if (stamp?.role === 'continue') this.start(stamp, view)
  }

  /** Each candidate, and each different set of the reader's own words, continues on its own. */
  private start(stamp: HoldStamp, view: DrawingView): void {
    let pick: DrawingPick = { nodeId: stamp.nodeId, heading: stamp.heading, revision: stamp.revision }
    if (stamp.custom) {
      try {
        pick = { nodeId: stamp.nodeId, custom: this.deps.surface.on?.(view).ownWords(stamp.runId, stamp.nodeId) ?? '', revision: stamp.revision }
      } catch (error) {
        this.deps.notify(error instanceof Error ? error.message : UNREACHABLE_DRAWING)
        return
      }
    }
    const key = `${stamp.runId}:${stamp.nodeId}:${pick.custom === undefined ? `candidate:${pick.heading}` : `words:${pick.custom}`}`
    const now = this.deps.now()
    if (this.going.has(key)) return
    if (now - (this.startedAt.get(key) ?? -Infinity) < DOUBLE_CLICK_MS) return
    this.startedAt.set(key, now)
    if (pick.custom === '') {
      this.deps.notify(TYPE_FIRST)
      return
    }
    this.going.add(key)
    void this.pick(stamp, pick, view).finally(() => this.going.delete(key))
  }

  private async pick(stamp: HoldStamp, pick: DrawingPick, view: DrawingView): Promise<void> {
    try {
      if (await this.deps.holds.resume(stamp.runId, pick)) return
      const refreshed = await this.deps.holds.read(stamp.runId)
      if (refreshed?.holds.find(hold => hold.nodeId === stamp.nodeId)?.revision !== stamp.revision) {
        await this.deps.refreshColumn(stamp.runId, stamp.nodeId, view)
      }
    } catch (error) {
      this.deps.notify(error instanceof Error ? error.message : UNREACHABLE_DRAWING)
    }
  }
}
