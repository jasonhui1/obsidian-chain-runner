import { proposerPanels, verdictPanel } from './holdNote'
import { isEvent, type LayoutPanel, type RunEvent } from '../engine/types'

/**
 * A rerun's progress, read off the engine's own frames (ADR-0001): the cards it
 * writes again are the ones its first frame has waiting.
 */

/** A step a rerun has started: named as its card is, or else by its agent, and whether it writes the new verdict. */
export interface RerunStep {
  name: string
  writesVerdict: boolean
}

/** What a rerun writes again — the verdict, and proposals by name — and the step it is on, once it has started one. */
export interface RerunProgress {
  verdict: boolean
  proposals: string[]
  step?: RerunStep
}

export type OnRerunProgress = (progress: RerunProgress) => void

export class RerunProgressTracker {
  private panels: LayoutPanel[] = []
  /** The nodes the first frame had waiting; `undefined` until it comes. */
  private rewritten: Set<string> | undefined
  private step: RerunStep | undefined

  /** The progress after `event`; `undefined` while nothing can be said yet, or `event` changed nothing. */
  hear(event: RunEvent): RerunProgress | undefined {
    if (isEvent(event, 'layout')) {
      this.panels = event.model.panels
      this.rewritten ??= new Set(this.panels.filter(panel => panel.state === 'pending').map(panel => panel.node))
    } else if (isEvent(event, 'agent_start')) {
      const shown = this.panels.find(panel => panel.node === event.nodeId)
      this.step = { name: shown?.name ?? event.agentName, writesVerdict: shown !== undefined && shown === verdictPanel(this.panels) }
    } else {
      return undefined
    }
    return this.progress()
  }

  /** A card that fills stays written again: what it holds lands only with the run. */
  private progress(): RerunProgress | undefined {
    const rewritten = this.rewritten
    if (!rewritten) return undefined
    const writing = this.panels.filter(panel => rewritten.has(panel.node) && panel.state !== 'skipped')
    return {
      verdict: writing.some(panel => panel === verdictPanel(this.panels)),
      proposals: proposerPanels(writing).map(panel => panel.name),
      ...(this.step ? { step: this.step } : {}),
    }
  }
}
