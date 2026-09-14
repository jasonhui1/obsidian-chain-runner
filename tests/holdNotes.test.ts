import { describe, it, expect, beforeEach } from 'vitest'
import { HoldNotes } from '@/ui/holdNotes'
import type { HoldNoteInput } from '@/run/holdNote'
import type { App, TFile } from 'obsidian'
import { TFile as StubFile, TFolder } from './obsidian'

/**
 * The vault half of the hold-note convention: where it writes, and what a
 * second write does to a Direction the human already touched.
 */

const input = (over: Partial<HoldNoteInput> = {}): HoldNoteInput => ({
  runId: '2026-09-15-Ab3dE1',
  chainName: 'creative-director',
  panels: [{ name: 'character-director', node: 'character', text: 'Shrine-maiden silhouette.', lines: 1, state: 'filled' }],
  thoughts: {},
  ...over,
})

let notes: Record<string, string>
let folders: string[]
let notices: string[]

function file(path: string): TFile {
  const stub = new StubFile()
  stub.path = path
  stub.name = path.slice(path.lastIndexOf('/') + 1)
  return stub as unknown as TFile
}

function makeHoldNotes(): HoldNotes {
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
      modify: (target: { path: string }, content: string) => {
        notes[target.path] = content
        return Promise.resolve()
      },
      createFolder: (path: string) => {
        folders.push(path)
        return Promise.resolve(undefined)
      },
    },
  } as unknown as App

  return new HoldNotes({ app, notify: message => void notices.push(message) })
}

beforeEach(() => {
  notes = {}
  folders = []
  notices = []
})

describe('write', () => {
  it('writes the hold under Maestro/holds, making the folders it needs', async () => {
    await makeHoldNotes().write(input())
    expect(folders).toEqual(['Maestro', 'Maestro/holds'])
    expect(notes['Maestro/holds/2026-09-15-Ab3dE1.md']).toContain('Shrine-maiden silhouette.')
  })

  it('overwrites the same file on a second write of a run with nothing to keep', async () => {
    const holdNotes = makeHoldNotes()
    await holdNotes.write(input())
    await holdNotes.write(input())
    expect(Object.keys(notes)).toEqual(['Maestro/holds/2026-09-15-Ab3dE1.md'])
  })

  it('keeps the Direction the human wrote across a second write', async () => {
    const holdNotes = makeHoldNotes()
    const path = 'Maestro/holds/2026-09-15-Ab3dE1.md'
    await holdNotes.write(input())
    notes[path] = notes[path].replace('KEEP:\nCHANGE:', 'KEEP: fast combat\nCHANGE:')

    await holdNotes.write(input())
    expect(notes[path]).toContain('KEEP: fast combat')
  })

  it('says why, and writes nothing, when the vault refuses the folder', async () => {
    notes['Maestro'] = 'a note, not a folder'
    await makeHoldNotes().write(input())
    expect(notices).toEqual(['Could not write the hold note: Maestro is a note, not a folder'])
  })
})
