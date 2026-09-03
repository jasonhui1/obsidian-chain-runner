import { describe, it, expect, beforeEach } from 'vitest'
import { KeepMarks, NOTHING_MARKED, NOTHING_TO_MARK, type MarkSource } from '@/ui/keepMarks'
import { NOT_SETTLED } from '@/ui/keepPiece'
import { OutputNotes } from '@/ui/outputNotes'
import type { MarkRange } from '@/run/keepMarks'
import type { RunPanel } from '@/run/panels'
import type { SeedSource } from '@/run/seed'
import type { RunResult } from '@/run/session'
import type { App, TFile } from 'obsidian'
// The test-time `obsidian` stub, imported by path so `tsc` still checks the
// plugin against the real module's types.
import { TFile as StubFile, TFolder, lastModal, resetModals } from './obsidian'

/**
 * Where the marks go once they are made: a trimmed note that keeps its
 * provenance, or the seed of the next chain. What the marks mean is
 * `keepMarks.test.ts`.
 */

const TEXT = ['one', 'two', 'three'].join('\n')

const panel = (over: Partial<RunPanel> = {}): RunPanel => ({
  name: 'Optimist',
  node: 'n1',
  text: TEXT,
  lines: 3,
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

let notes: Record<string, string>
let folders: string[]
let opened: string[]
let notices: string[]
let launched: { text: string; source: SeedSource }[]
/** The lines the marking surface was handed, and how it is answered. */
let marking: { text: string; done: (marked: MarkRange[]) => void } | undefined

function file(path: string): TFile {
  const stub = new StubFile()
  stub.path = path
  stub.name = path.slice(path.lastIndexOf('/') + 1)
  stub.basename = stub.name.replace(/\.md$/, '')
  return stub as unknown as TFile
}

function makeMarks(): KeepMarks {
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

  const notify = (message: string): void => void notices.push(message)
  return new KeepMarks({
    app,
    notify,
    notes: new OutputNotes({ app, notify, folder: () => 'chains/runs', engineUrl: () => 'http://localhost:3000' }),
    mark: (text, done) => {
      marking = { text, done }
    },
    runChain: input => void launched.push(input),
  })
}

/** Marks lines, answers the destination suggester, and lets the writes finish. */
async function keep(source: MarkSource, marked: number[], destination?: number): Promise<void> {
  makeMarks().start(source)
  marking?.done(marked.map(line => ({ from: line, to: line })))
  if (destination !== undefined) lastModal()?.choose(destination)
  await new Promise(resolve => setTimeout(resolve, 0))
}

/** The order of the destination suggester's rows. */
const AS_NOTE = 0
const AS_CHAIN = 1

const fromPanel = (over: Partial<RunResult> = {}): MarkSource => ({
  kind: 'panel',
  text: TEXT,
  panel: panel(),
  run: result(over),
})

const fromNote = (path = 'notes/premise.md'): MarkSource => ({ kind: 'note', text: TEXT, file: file(path) })

beforeEach(() => {
  notes = {}
  folders = []
  opened = []
  notices = []
  launched = []
  marking = undefined
  resetModals()
})

describe('marking', () => {
  it('hands the marking surface the text as it stands, line for line', () => {
    makeMarks().start(fromPanel())
    expect(marking?.text).toBe(TEXT)
  })

  it('does not open a marking surface over nothing', () => {
    makeMarks().start({ ...fromPanel(), text: '   \n\n' })
    expect(marking).toBeUndefined()
    expect(notices).toEqual([NOTHING_TO_MARK])
  })

  it('asks nowhere to put marks that were never made', async () => {
    await keep(fromPanel(), [])
    expect(lastModal()).toBeUndefined()
    expect(notices).toEqual([NOTHING_MARKED])
  })

  it('asks where the marks go once, at the end, and writes nothing before that', async () => {
    await keep(fromPanel(), [0, 2])
    expect(lastModal()?.placeholder).toBe('Where do the marked lines go?')
    expect(notes).toEqual({})
  })
})

describe('a trimmed note from a panel', () => {
  it('keeps the run provenance, and only the marked lines', async () => {
    await keep(fromPanel(), [0, 2], AS_NOTE)

    const path = 'chains/runs/2026-09-02-ab12c/Optimist (kept).md'
    expect(notes[path]).toContain('run: "2026-09-02-ab12c"')
    expect(notes[path]).toContain('chain: "Five Personas"')
    expect(notes[path]).toContain('one\n\nthree')
    expect(notes[path]).not.toContain('two')
    expect(opened).toEqual([path])
  })

  it('leaves the panel own note free, so both can be kept', async () => {
    await keep(fromPanel(), [1], AS_NOTE)
    expect(Object.keys(notes)).toEqual(['chains/runs/2026-09-02-ab12c/Optimist (kept).md'])
  })

  it('writes nothing for a run with no id, and says why', async () => {
    await keep(fromPanel({ runId: undefined }), [0], AS_NOTE)
    expect(notes).toEqual({})
    expect(notices).toEqual([NOT_SETTLED])
  })
})

describe('a trimmed note from a note', () => {
  it('goes beside the note, naming the note it was trimmed from', async () => {
    await keep(fromNote(), [1], AS_NOTE)

    const path = 'notes/premise (kept).md'
    expect(notes[path]).toBe('---\nkept from: "[[premise]]"\n---\n\ntwo\n')
    expect(opened).toEqual([path])
  })

  it('suffixes past a note of the same name that says something else', async () => {
    notes['notes/premise (kept).md'] = 'a note the reader wrote'
    await keep(fromNote(), [1], AS_NOTE)
    expect(notes['notes/premise (kept) 2.md']).toContain('two')
    expect(notes['notes/premise (kept).md']).toBe('a note the reader wrote')
  })

  it('reuses a trimmed note that already says exactly this', async () => {
    await keep(fromNote(), [1], AS_NOTE)
    await keep(fromNote(), [1], AS_NOTE)
    expect(Object.keys(notes)).toEqual(['notes/premise (kept).md'])
  })
})

describe('the marks as the next chain seed', () => {
  it('launches on the marked lines, named for the note they came off', async () => {
    await keep(fromNote(), [0, 1], AS_CHAIN)
    expect(launched).toEqual([{ text: 'one\ntwo', source: { name: 'premise.md', path: 'notes/premise.md' } }])
    expect(notes).toEqual({})
  })

  it('names the panel a run marked lines came off', async () => {
    await keep(fromPanel(), [2], AS_CHAIN)
    expect(launched).toEqual([{ text: 'three', source: { name: 'Five Personas · Optimist', path: '' } }])
  })
})
