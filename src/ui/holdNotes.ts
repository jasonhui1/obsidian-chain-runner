import { normalizePath } from 'obsidian'
import { holdHeading, holdNoteContent, holdNotePath, mergeHoldNote, reranFrom, waitingHoldsIn, type HoldNoteInput } from '../run/holdNote'
import { folderOf, type NoteStore } from './noteStore'
import { ensureFolder, guardWrite } from './vaultWrite'

/**
 * The vault half of the hold-note convention; the note itself is
 * `src/run/holdNote.ts`. A run directed twice writes the same file, merged so
 * the human's Direction is never overwritten.
 */

export class HoldNotes {
  constructor(
    private readonly deps: {
      store: NoteStore
      notify: (message: string) => void
    },
  ) {}

  /** Where the run's hold note is, written or not. */
  pathOf(runId: string): string {
    return normalizePath(holdNotePath(runId))
  }

  /** Where the run's hold note is, if one has been written. */
  find(runId: string): string | undefined {
    const path = this.pathOf(runId)
    return this.deps.store.at(path) === 'note' ? path : undefined
  }

  /** The run `runId`'s hold now lives under: itself, or the newest run a rerun moved its hold to. */
  async currentRun(runId: string): Promise<string> {
    if (this.find(runId)) return runId
    const { store } = this.deps
    const path = this.pathOf(runId)
    for (const hold of store.notesIn(folderOf(path))) {
      const content = (await store.read(hold)) ?? ''
      const heading = holdHeading(content)
      if (heading && reranFrom(content).includes(runId)) return heading.runId
    }
    return runId
  }

  /** The nodes whose holds the run's note shows as waiting; none without a note. */
  async holdsShown(runId: string): Promise<string[]> {
    const content = (await this.deps.store.read(this.pathOf(runId))) ?? ''
    return waitingHoldsIn(content).map(hold => hold.nodeId)
  }

  /** Where the hold note was written; `undefined` means the vault refused it, and said so. */
  async write(input: HoldNoteInput): Promise<string | undefined> {
    const { store } = this.deps
    const path = this.pathOf(input.runId)
    const fresh = holdNoteContent(input)
    return guardWrite(this.deps.notify, 'the hold note', async () => {
      await ensureFolder(store, folderOf(path))
      const previous = await store.read(path)
      if (previous === undefined) await store.create(path, fresh)
      else {
        const merged = mergeHoldNote(fresh, previous)
        if (merged !== previous) await store.modify(path, merged)
      }
      return path
    })
  }
}
