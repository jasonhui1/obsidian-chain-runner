import { describe, it, expect, beforeEach } from 'vitest'
import { KeepPiece, NOT_SETTLED } from '@/ui/keepPiece'
import { OutputNotes } from '@/ui/outputNotes'
import type { DrawingChoice } from '@/ui/drawingChoices'
import type { DrawingSurface } from '@/ui/excalidraw'
import type { RunPanel } from '@/run/panels'
import type { RunResult } from '@/run/session'
import type { App, TFile } from 'obsidian'
// The test-time `obsidian` stub, imported by path so `tsc` still checks the
// plugin against the real module's types.
import { TFile as StubFile, TFolder, lastModal, resetModals } from './obsidian'

/**
 * The seam between the output-note convention and the vault: what gets written,
 * where, what a second save does, and what reaches the drawing. The convention
 * itself is `outputNote.test.ts`.
 */

/** The engine an output note links back to; the run view is checked in `provenance.test.ts`. */
const ENGINE_URL = 'http://localhost:3000'

const panel = (over: Partial<RunPanel> = {}): RunPanel => ({
  name: 'Optimist',
  node: 'n1',
  text: 'It could work.',
  lines: 1,
  state: 'filled',
  ...over,
})

const result = (over: Partial<RunResult> = {}): RunResult => ({
  chainName: 'Five Personas',
  moment: '',
  seed: { note: 'premise.md', from: 'note' },
  status: 'done',
  runId: '2026-09-02-ab12c',
  layout: { kind: 'timeline', panels: [] },
  ...over,
})

/** The vault, as the actions see it: notes by path, and folders by path. */
let notes: Record<string, string>
let folders: string[]
let opened: string[]
let notices: string[]
let placed: { drawing: string; note: string }[]
let drawings: DrawingChoice[]
let unavailable: string | undefined

/** Lets the writes a picked drawing sets off finish before the assertions. */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const drawing = (path: string): DrawingChoice => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  mtime: 0,
  reason: 'open',
})

function file(path: string): TFile {
  const stub = new StubFile()
  stub.path = path
  stub.name = path.slice(path.lastIndexOf('/') + 1)
  stub.basename = stub.name.replace(/\.md$/, '')
  return stub as unknown as TFile
}

function makeKeep(): KeepPiece {
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => {
        if (notes[path] !== undefined) return file(path)
        if (folders.includes(path)) {
          const folder = new TFolder()
          folder.path = path
          return folder
        }
        return null
      },
      cachedRead: (target: { path: string }) => Promise.resolve(notes[target.path] ?? ''),
      create: (path: string, content: string) => {
        notes[path] = content
        return Promise.resolve(file(path))
      },
      createFolder: (path: string) => {
        folders.push(path)
        return Promise.resolve(undefined)
      },
    },
    workspace: {
      getLeaf: () => ({ openFile: (target: { path: string }) => Promise.resolve(opened.push(target.path)) }),
    },
  } as unknown as App

  const surface: DrawingSurface = {
    unavailable: () => unavailable,
    choices: () => drawings,
    place: (target, note) => {
      placed.push({ drawing: target.path, note: note.path })
      return Promise.resolve()
    },
  }

  const notify = (message: string): void => void notices.push(message)
  return new KeepPiece({
    app,
    notify,
    notes: new OutputNotes({ app, notify, folder: () => 'chains/runs', engineUrl: () => ENGINE_URL }),
    drawing: surface,
  })
}

beforeEach(() => {
  notes = {}
  folders = []
  opened = []
  notices = []
  placed = []
  drawings = [drawing('boards/wall.excalidraw.md')]
  unavailable = undefined
  resetModals()
})

describe('save as note', () => {
  it('writes the panel under the run’s own folder, and opens it', async () => {
    await makeKeep().saveAsNote(panel(), result())

    const path = 'chains/runs/2026-09-02-ab12c/Optimist.md'
    expect(notes[path]).toContain('run: "2026-09-02-ab12c"')
    expect(notes[path]).toContain('It could work.')
    expect(opened).toEqual([path])
  })

  it('makes the folders the note needs, top down', async () => {
    await makeKeep().saveAsNote(panel(), result())
    expect(folders).toEqual(['chains', 'chains/runs', 'chains/runs/2026-09-02-ab12c'])
  })

  it('leaves one note when the same panel is saved twice', async () => {
    const keep = makeKeep()
    await keep.saveAsNote(panel(), result())
    await keep.saveAsNote(panel(), result())
    expect(Object.keys(notes)).toEqual(['chains/runs/2026-09-02-ab12c/Optimist.md'])
  })

  it('suffixes past a note of the same name that says something else', async () => {
    notes['chains/runs/2026-09-02-ab12c/Optimist.md'] = 'a note the reader wrote'
    await makeKeep().saveAsNote(panel(), result())
    expect(notes['chains/runs/2026-09-02-ab12c/Optimist 2.md']).toContain('It could work.')
    expect(notes['chains/runs/2026-09-02-ab12c/Optimist.md']).toBe('a note the reader wrote')
  })

  it('writes nothing for a run with no id, and says why', async () => {
    await makeKeep().saveAsNote(panel(), result({ runId: undefined }))
    expect(notes).toEqual({})
    expect(notices).toEqual([NOT_SETTLED])
  })
})

describe('send to drawing', () => {
  it('writes the note and puts it on the drawing the reader picked', async () => {
    await makeKeep().sendToDrawing(panel(), result())
    lastModal()?.choose(0)
    await flush()

    const path = 'chains/runs/2026-09-02-ab12c/Optimist.md'
    expect(notes[path]).toContain('It could work.')
    expect(placed).toEqual([{ drawing: 'boards/wall.excalidraw.md', note: path }])
  })

  it('leaves nothing behind when the reader dismisses the suggester', async () => {
    await makeKeep().sendToDrawing(panel(), result())
    await flush()
    expect(notes).toEqual({})
    expect(folders).toEqual([])
  })

  it('reuses the note a save already wrote rather than making a second', async () => {
    const keep = makeKeep()
    await keep.saveAsNote(panel(), result())
    await keep.sendToDrawing(panel(), result())
    lastModal()?.choose(0)
    await flush()

    expect(Object.keys(notes)).toEqual(['chains/runs/2026-09-02-ab12c/Optimist.md'])
  })

  it('says the run has no id before opening a suggester it cannot act on', async () => {
    await makeKeep().sendToDrawing(panel(), result({ runId: undefined }))
    expect(lastModal()).toBeUndefined()
    expect(notices).toEqual([NOT_SETTLED])
  })

  it('says what is missing when the drawing surface cannot be used, and writes nothing', async () => {
    unavailable = 'Excalidraw is not installed'
    await makeKeep().sendToDrawing(panel(), result())
    expect(notices).toEqual(['Excalidraw is not installed'])
    expect(notes).toEqual({})
  })

  it('does not open an empty suggester when the vault holds no drawing', async () => {
    drawings = []
    await makeKeep().sendToDrawing(panel(), result())
    expect(lastModal()).toBeUndefined()
    expect(notices).toEqual(['No Excalidraw drawing in this vault to send it to'])
    expect(notes).toEqual({})
  })
})
