import { normalizePath, TFile, type App } from 'obsidian'
import {
  freeOutputPath,
  outputNoteContent,
  outputNotePath,
  resolveOutputPath,
  type OutputNoteMeta,
} from '../run/outputNote'
import type { RunPanel } from '../run/panels'
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
  file: TFile
  write(panel: RunPanel): Promise<void>
}

export interface OutputNotesDeps {
  app: App
  notify: (message: string) => void
  /** Read per write, so changing the setting takes at once. */
  folder: () => string
  engineUrl: () => string
}

export class OutputNotes {
  constructor(private readonly deps: OutputNotesDeps) {}

  /** A settled panel's note. `undefined` means the vault refused it, and said so. */
  async write(panel: RunPanel, run: RunProvenance): Promise<TFile | undefined> {
    return this.inFolder(panel, run, (meta, wanted) => this.writeOrReuse(wanted, outputNoteContent(panel, meta)))
  }

  /**
   * A note at a path the caller chose, written by the convention's own rules —
   * for what no run wrote, such as the lines kept off a note.
   */
  async writeNote(path: string, content: string): Promise<TFile | undefined> {
    return this.guard(async () => {
      const wanted = normalizePath(path)
      await ensureFolder(this.deps.app, wanted.slice(0, wanted.lastIndexOf('/')))
      return this.writeOrReuse(wanted, content)
    })
  }

  /**
   * Removes a note this plugin wrote - a proposal the reader dropped. To the
   * trash, not gone, so the reader's own deletion setting decides how final it is.
   */
  async remove(path: string): Promise<void> {
    await this.guard(async () => {
      const file = this.deps.app.vault.getAbstractFileByPath(path)
      if (file instanceof TFile) await this.deps.app.fileManager.trashFile(file)
    })
  }

  /** The note at `wanted`, written or already there: one saying exactly this is reused. */
  private async writeOrReuse(wanted: string, content: string): Promise<TFile> {
    const path = await resolveOutputPath(wanted, content, candidate => this.read(candidate))
    const existing = this.deps.app.vault.getAbstractFileByPath(path)
    if (existing instanceof TFile) return existing
    return this.deps.app.vault.create(path, content)
  }

  /**
   * A note created empty and rewritten as its panel fills. The path is settled
   * once: Excalidraw stores it in its scene file, out of reach of Obsidian's
   * link-updating, so a moved note would leave a dead embeddable.
   */
  async open(panel: RunPanel, run: RunProvenance): Promise<OpenOutputNote | undefined> {
    return this.inFolder(panel, run, async (meta, wanted) => {
      const path = await freeOutputPath(wanted, candidate => this.read(candidate))
      const file = await this.deps.app.vault.create(path, outputNoteContent(panel, meta))
      let said = ''
      return {
        file,
        write: async next => {
          const content = outputNoteContent(next, meta)
          if (content === said) return
          said = content
          await this.deps.app.vault.modify(file, content)
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
      await ensureFolder(this.deps.app, wanted.slice(0, wanted.lastIndexOf('/')))
      return use(meta, wanted)
    })
  }

  private guard<T>(use: () => Promise<T>): Promise<T | undefined> {
    return guardWrite(this.deps.notify, 'the note', use)
  }

  private async read(path: string): Promise<string | undefined> {
    const file = this.deps.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return undefined
    return this.deps.app.vault.cachedRead(file)
  }
}
