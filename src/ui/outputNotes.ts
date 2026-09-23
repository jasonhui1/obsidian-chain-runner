import { normalizePath } from 'obsidian'
import {
  freeOutputPath,
  outputNoteContent,
  outputNotePath,
  resolveOutputPath,
  type OutputNoteMeta,
} from '../run/outputNote'
import type { RunPanel } from '../run/panels'
import { folderOf, type NoteStore } from './noteStore'
import { ensureFolder, guardWrite } from './vaultWrite'

/**
 * The vault half of the output-note convention; the note itself is
 * `src/run/outputNote.ts`. Both surfaces write through this, so a panel kept
 * twice is one note. `write` takes a settled panel, `open` one still filling.
 */

/** Which run a panel came from; the folder and the engine are settings'. */
export type RunProvenance = Omit<OutputNoteMeta, 'folder' | 'engineUrl'>

/** A note a run holds open, to rewrite as its panel fills. */
export interface OpenOutputNote {
  path: string
  /** `force` rewrites unchanged content for the settled run's final embed refresh. */
  write(panel: RunPanel, force?: boolean): Promise<void>
}

export interface OutputNotesDeps {
  store: NoteStore
  notify: (message: string) => void
  /** Read per write, so changing the setting takes at once. */
  folder: () => string
  engineUrl: () => string
}

export class OutputNotes {
  constructor(private readonly deps: OutputNotesDeps) {}

  /** Where a settled panel's note is. `undefined` means the vault refused it, and said so. */
  async write(panel: RunPanel, run: RunProvenance): Promise<string | undefined> {
    return this.inFolder(panel, run, (meta, wanted) => this.writeOrReuse(wanted, outputNoteContent(panel, meta)))
  }

  /**
   * A note at a path the caller chose, written by the convention's own rules —
   * for what no run wrote, such as the lines kept off a note.
   */
  async writeNote(path: string, content: string): Promise<string | undefined> {
    return this.guard(async () => {
      const wanted = normalizePath(path)
      await ensureFolder(this.deps.store, folderOf(wanted))
      return this.writeOrReuse(wanted, content)
    })
  }

  /**
   * Removes a note this plugin wrote - a proposal the reader dropped. To the
   * trash, not gone, so the reader's own deletion setting decides how final it is.
   */
  async remove(path: string): Promise<void> {
    await this.guard(() => this.deps.store.trash(path))
  }

  /** The note at `wanted`, written or already there: one saying exactly this is reused. */
  private async writeOrReuse(wanted: string, content: string): Promise<string> {
    const { store } = this.deps
    const path = await resolveOutputPath(wanted, content, candidate => store.read(candidate))
    if (store.at(path) !== 'note') await store.create(path, content)
    return path
  }

  /**
   * A note created empty and rewritten as its panel fills. The path is settled
   * once: Excalidraw stores it in its scene file, out of reach of Obsidian's
   * link-updating, so a moved note would leave a dead embeddable.
   */
  async open(panel: RunPanel, run: RunProvenance): Promise<OpenOutputNote | undefined> {
    return this.inFolder(panel, run, async (meta, wanted) => {
      const { store } = this.deps
      const path = await freeOutputPath(wanted, candidate => store.read(candidate))
      await store.create(path, outputNoteContent(panel, meta))
      let said = ''
      return {
        path,
        write: async (next, force = false) => {
          const content = outputNoteContent(next, meta)
          if (!force && content === said) return
          said = content
          await store.modify(path, content)
        },
      }
    })
  }

  /** Runs `use` with the run's folder made; a refusal is one notice and `undefined`. */
  private async inFolder<T>(
    panel: RunPanel,
    run: RunProvenance,
    use: (meta: OutputNoteMeta, wanted: string) => Promise<T>,
  ): Promise<T | undefined> {
    const meta: OutputNoteMeta = { ...run, folder: this.deps.folder(), engineUrl: this.deps.engineUrl() }
    const wanted = normalizePath(outputNotePath(panel, meta))
    return this.guard(async () => {
      await ensureFolder(this.deps.store, folderOf(wanted))
      return use(meta, wanted)
    })
  }

  private guard<T>(use: () => Promise<T>): Promise<T | undefined> {
    return guardWrite(this.deps.notify, 'the note', use)
  }
}
