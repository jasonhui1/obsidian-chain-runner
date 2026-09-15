import { normalizePath, TFile, type App, type TAbstractFile } from 'obsidian'
import { guardWrite, readIfPresent } from './vaultWrite'
import { appendDirectionLine, directionLine, holdNotePath, readHold, tickCanonLine, type DirectionVerb, type HoldReading } from '../run/holdNote'

/**
 * Hold actions: everything the directing panel reads from a hold or does to it,
 * as plain data. Backed by the hold note today; only this module knows that.
 */

export { DIRECTION_VERBS, type CanonChoice, type DirectionVerb, type HoldProposal, type HoldReading } from '../run/holdNote'

export interface HoldActionsDeps {
  app: App
  notify: (message: string) => void
}

export class HoldActions {
  constructor(private readonly deps: HoldActionsDeps) {}

  /** The run's hold, or `undefined` when none has been written. */
  async read(runId: string): Promise<HoldReading | undefined> {
    const content = await readIfPresent(this.deps.app, pathOf(runId))
    return content === undefined ? undefined : readHold(content)
  }

  /** A verb given to a proposal; COMBINE names the second proposal it joins. */
  direct(runId: string, verb: DirectionVerb, proposal: string, other?: string): Promise<void> {
    return this.edit(runId, content => appendDirectionLine(content, directionLine(verb, proposal, other)))
  }

  /** A canon line, by its `id`, ticked or unticked. */
  tickCanon(runId: string, id: string, ticked: boolean): Promise<void> {
    return this.edit(runId, content => tickCanonLine(content, id, ticked))
  }

  /** Calls `listener` whenever the run's hold changes, by any hand; returns what stops it. */
  onChange(runId: string, listener: () => void): () => void {
    const vault = this.deps.app.vault
    const path = pathOf(runId)
    const heard = (file: TAbstractFile): void => {
      if (file.path === path) listener()
    }
    const refs = [vault.on('modify', heard), vault.on('create', heard), vault.on('delete', heard)]
    return () => refs.forEach(ref => vault.offref(ref))
  }

  private async edit(runId: string, change: (content: string) => string): Promise<void> {
    const file = this.deps.app.vault.getAbstractFileByPath(pathOf(runId))
    if (!(file instanceof TFile)) return
    await guardWrite(this.deps.notify, 'the hold note', () => this.deps.app.vault.process(file, change))
  }
}

function pathOf(runId: string): string {
  return normalizePath(holdNotePath(runId))
}
