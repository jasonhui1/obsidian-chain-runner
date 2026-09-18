import { describe, it, expect, beforeEach } from 'vitest'
import { HoldNotes } from '@/ui/holdNotes'
import type { HoldNoteInput } from '@/run/holdNote'
import { MemoryNoteStore } from './memoryNoteStore'

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

let store: MemoryNoteStore
let notes: Record<string, string>
let notices: string[]

function makeHoldNotes(): HoldNotes {
  return new HoldNotes({ store, notify: message => void notices.push(message) })
}

beforeEach(() => {
  store = new MemoryNoteStore()
  notes = store.notes
  notices = []
})

describe('currentRun', () => {
  const ORIGINAL = '2026-09-15-ubqPU2'
  const hold = (runId: string, reranFrom: string[] = []): string =>
    [
      `# Hold: run ${runId} · creative-director`,
      '',
      ...(reranFrom.length ? ['## Previous verdict', '', ...reranFrom.map(run => `<details>\n<summary>run ${run}</summary>\n\nA verdict.\n\n</details>`), ''] : []),
      '## Proposals',
      '## Direction',
      '',
    ].join('\n')

  it('is the run itself while its hold is where it was written', async () => {
    notes[`Maestro/holds/${ORIGINAL}.md`] = hold(ORIGINAL)
    expect(await makeHoldNotes().currentRun(ORIGINAL)).toBe(ORIGINAL)
  })

  it('is the run a rerun moved the hold to', async () => {
    notes['Maestro/holds/2026-09-15-WKRDJJ.md'] = hold('2026-09-15-WKRDJJ', [ORIGINAL])
    notes['Maestro/holds/2026-09-15-other.md'] = hold('2026-09-15-other', ['2026-09-14-elsewhere'])
    expect(await makeHoldNotes().currentRun(ORIGINAL)).toBe('2026-09-15-WKRDJJ')
  })

  it('is the newest, when more than one hold was rerun from it', async () => {
    notes['Maestro/holds/2026-09-15-WKRDJJ.md'] = hold('2026-09-15-WKRDJJ', [ORIGINAL])
    notes['Maestro/holds/2026-09-15-D_QS9w.md'] = hold('2026-09-15-D_QS9w', [ORIGINAL])
    store.touch('Maestro/holds/2026-09-15-WKRDJJ.md', 1)
    store.touch('Maestro/holds/2026-09-15-D_QS9w.md', 2)
    expect(await makeHoldNotes().currentRun(ORIGINAL)).toBe('2026-09-15-D_QS9w')
  })

  it('is the run itself when no hold was rerun from it', async () => {
    notes['Maestro/holds/2026-09-15-other.md'] = hold('2026-09-15-other', ['2026-09-14-elsewhere'])
    notes['Notes/not-a-hold.md'] = hold('2026-09-15-stray', [ORIGINAL])
    expect(await makeHoldNotes().currentRun(ORIGINAL)).toBe(ORIGINAL)
  })
})

describe('write', () => {
  it('writes the hold under Maestro/holds, making the folders it needs', async () => {
    await makeHoldNotes().write(input())
    expect(store.folders).toEqual(['Maestro', 'Maestro/holds'])
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
