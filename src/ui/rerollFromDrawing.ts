import { holdStamp, type HoldStamp } from './holdColumn'
import type { DrawingView, SelectionSurface } from './excalidraw'
import type { Holds } from './holds'
import { UNREACHABLE_DRAWING } from './onDrawing'

const DOUBLE_CLICK_MS = 1000
export const REROLL_ALREADY_ANSWERED = 'This hold has already been answered. Candidates can only be rerolled while the hold is open.'

export interface RerollFromDrawingDeps {
  surface: SelectionSurface
  holds: Pick<Holds, 'reroll' | 'read'>
  notify: (message: string) => void
  now: () => number
  refreshColumn: (runId: string, nodeId: string, view: DrawingView) => Promise<void>
}

export class RerollFromDrawing {
  private last: { stamp: HoldStamp; view: DrawingView; at: number } | undefined
  private doubleAt: number | undefined
  private going = new Set<string>()
  private startedAt = new Map<string, number>()

  constructor(private readonly deps: RerollFromDrawingDeps) {}

  handleSelection(element: { customData?: unknown }, view: DrawingView): void {
    const stamp = holdStamp(element)
    if (stamp?.role !== 'reroll') return
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
      const selected = this.deps.surface.on?.(last?.view).selectedReroll()
      const stamp = selected && holdStamp(selected)
      if (stamp?.role === 'reroll' && last?.view) {
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
    if (stamp?.role === 'reroll') this.start(stamp, view)
  }

  private start(stamp: HoldStamp, view: DrawingView): void {
    const key = `${stamp.runId}:${stamp.nodeId}`
    const now = this.deps.now()
    if (this.going.has(key) || now - (this.startedAt.get(key) ?? -Infinity) < DOUBLE_CLICK_MS) return
    this.going.add(key)
    this.startedAt.set(key, now)
    void this.reroll(stamp, view).finally(() => this.going.delete(key))
  }

  private async reroll(stamp: HoldStamp, view: DrawingView): Promise<void> {
    try {
      const current = await this.deps.holds.read(stamp.runId)
      if (!current) return
      const open = current.holds.find(hold => hold.nodeId === stamp.nodeId)
      if (!open) {
        this.deps.notify(REROLL_ALREADY_ANSWERED)
        return
      }
      const refreshed = await this.deps.holds.reroll(stamp.runId, stamp.nodeId)
      if (!refreshed) return
      const updated = refreshed.holds.find(hold => hold.nodeId === stamp.nodeId)
      if (updated && updated.revision !== stamp.revision && updated.candidates.length > 0) {
        await this.deps.refreshColumn(stamp.runId, stamp.nodeId, view)
      }
    } catch (error) {
      this.deps.notify(error instanceof Error ? error.message : UNREACHABLE_DRAWING)
    }
  }
}
