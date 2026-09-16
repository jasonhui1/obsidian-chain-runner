import type { EngineClient } from '../engine/client'
import { engineFailureMessage } from '../engine/guard'
import type { LayoutPanel } from '../engine/types'

/** What each finished run wrote, panel by panel. A finished run's panels never change, so each is fetched once. */
export class RunPanels {
  private readonly byRun = new Map<string, LayoutPanel[]>()

  constructor(private readonly engine: EngineClient) {}

  /** `undefined`, without a notice, while the engine cannot say. */
  async of(runId: string): Promise<LayoutPanel[] | undefined> {
    const known = this.byRun.get(runId)
    if (known) return known
    try {
      const { panels } = await this.engine.getLayout(runId)
      this.byRun.set(runId, panels)
      return panels
    } catch (error) {
      if (engineFailureMessage(error) === undefined) throw error
      return undefined
    }
  }
}
