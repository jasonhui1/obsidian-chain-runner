import { holdStamp, type HoldStamp } from './holdColumn'
import type { DrawingView, SelectionSurface } from './excalidraw'
import type { Holds } from './holds'
import { UNREACHABLE_DRAWING } from './onDrawing'

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
  private going = new Map<string, string>()
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

  private start(stamp: HoldStamp, view: DrawingView): void {
    const key = `${stamp.runId}:${stamp.nodeId}:${stamp.heading}`
    const now = this.deps.now()
    if (this.going.has(key)) return
    if (now - (this.startedAt.get(key) ?? -Infinity) < DOUBLE_CLICK_MS) return
    this.going.set(key, stamp.heading)
    this.startedAt.set(key, now)
    void this.pick(stamp, view).finally(() => this.going.delete(key))
  }

  private async pick(stamp: HoldStamp, view: DrawingView): Promise<void> {
    try {
      const resumed = await this.deps.holds.resume(stamp.runId, { nodeId: stamp.nodeId, heading: stamp.heading, revision: stamp.revision })
      if (!resumed) {
        const refreshed = await this.deps.holds.read(stamp.runId)
        if (refreshed?.holds.find(hold => hold.nodeId === stamp.nodeId)?.revision !== stamp.revision) {
          await this.deps.refreshColumn(stamp.runId, stamp.nodeId, view)
        }
      }
    } catch (error) {
      this.deps.notify(error instanceof Error ? error.message : UNREACHABLE_DRAWING)
    }
  }
}
