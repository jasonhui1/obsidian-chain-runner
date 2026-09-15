import type { App, TAbstractFile } from 'obsidian'
import type { HoldNotes } from './holdNotes'
import { guardWrite } from './vaultWrite'
import {
  appendDirectionLine,
  directionLine,
  readHold,
  removeDirectionLines,
  tickCanonLine,
  type DirectionVerb,
  type HoldReading,
} from '../run/holdNote'

/**
 * Hold actions: everything the directing panel reads from a hold or does to it,
 * as plain data. Backed by the hold note; only this module knows that.
 */

export { DIRECTION_VERBS, type CanonChoice, type DirectionVerb, type HoldProposal, type HoldReading } from '../run/holdNote'

export interface HoldActionsDeps {
  app: App
  notify: (message: string) => void
  notes: HoldNotes
  /** Writes a run's hold from what the engine recorded. */
  write: (runId: string) => Promise<unknown>
}

export class HoldActions {
  constructor(private readonly deps: HoldActionsDeps) {}

  /** The run's hold, or `undefined` when none has been written. */
  async read(runId: string): Promise<HoldReading | undefined> {
    const file = this.deps.notes.find(runId)
    return file ? readHold(await this.deps.app.vault.cachedRead(file)) : undefined
  }

  /** A verb given to a proposal; COMBINE names the second proposal it joins. */
  direct(runId: string, verb: DirectionVerb, proposal: string, other?: string): Promise<void> {
    return this.edit(runId, content => appendDirectionLine(content, directionLine(verb, proposal, other)))
  }

  /** A verb taken back off a proposal; a COMBINE whichever way round it was written. */
  undirect(runId: string, verb: DirectionVerb, proposal: string, other?: string): Promise<void> {
    const lines = [directionLine(verb, proposal, other), ...(other ? [directionLine(verb, other, proposal)] : [])]
    return this.edit(runId, content => removeDirectionLines(content, lines))
  }

  /** A canon line, by its `id`, ticked or unticked. */
  tickCanon(runId: string, id: string, ticked: boolean): Promise<void> {
    return this.edit(runId, content => tickCanonLine(content, id, ticked))
  }

  /** Writes the hold for a run that has none. */
  async writeHold(runId: string): Promise<void> {
    await this.deps.write(runId)
  }

  async openInTab(runId: string): Promise<void> {
    const file = this.deps.notes.find(runId)
    if (file) await this.deps.app.workspace.getLeaf('tab').openFile(file)
  }

  /** Calls `listener` whenever the run's hold changes, by any hand; returns what stops it. */
  onChange(runId: string, listener: () => void): () => void {
    const vault = this.deps.app.vault
    const path = this.deps.notes.pathOf(runId)
    const heard = (file: TAbstractFile): void => {
      if (file.path === path) listener()
    }
    const refs = [vault.on('modify', heard), vault.on('create', heard), vault.on('delete', heard)]
    return () => refs.forEach(ref => vault.offref(ref))
  }

  private async edit(runId: string, change: (content: string) => string): Promise<void> {
    const file = this.deps.notes.find(runId)
    if (!file) return
    await guardWrite(this.deps.notify, 'the hold note', () => this.deps.app.vault.process(file, change))
  }
}
