import { describe, it, expect } from 'vitest'
import { baseName, fileName, frontOf } from '@/ui/noteStore'

/** The vault adapter's own decisions: which note is in front, and what a path is called. */

const note = (path: string, extension = 'md') => ({ path, extension })

describe('frontOf', () => {
  it('takes the note and the selection from one pane, even when another leaf is active', () => {
    expect(frontOf({ file: note('aside.md'), selection: 'a passage' }, note('premise.md'))).toEqual({ path: 'aside.md', selection: 'a passage' })
  })

  it('falls back to the active file, with no selection, when no editor is open', () => {
    expect(frontOf(undefined, note('premise.md'))).toEqual({ path: 'premise.md' })
  })

  it('is no note when what is in front is not markdown', () => {
    expect(frontOf(undefined, note('wall.png', 'png'))).toBeUndefined()
    expect(frontOf(undefined, null)).toBeUndefined()
  })
})

describe('names', () => {
  it('names a note by its file, with and without the extension', () => {
    expect(fileName('notes/the premise.md')).toBe('the premise.md')
    expect(baseName('notes/the premise.md')).toBe('the premise')
    expect(baseName('boards/wall.excalidraw.md')).toBe('wall.excalidraw')
  })
})
