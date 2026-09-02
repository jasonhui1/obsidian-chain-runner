import { describe, it, expect } from 'vitest'
import { drawingChoices, isDrawingPath } from '@/ui/drawingChoices'

/**
 * Which drawings the suggester offers, and in what order. The ticket asks for
 * "an open or recent drawing", and that is an ordering decision rather than a
 * vault one — so it is decided here and checked without Obsidian.
 */

const file = (path: string, mtime: number): { path: string; name: string; mtime: number } => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  mtime,
})

const files = [
  file('boards/old.excalidraw.md', 100),
  file('boards/fresh.excalidraw.md', 300),
  file('boards/open.excalidraw.md', 200),
  file('boards/read.excalidraw.md', 50),
]

describe('isDrawingPath', () => {
  it('knows Excalidraw’s two file shapes', () => {
    expect(isDrawingPath('boards/a.excalidraw.md')).toBe(true)
    expect(isDrawingPath('boards/a.excalidraw')).toBe(true)
  })

  it('leaves ordinary notes alone', () => {
    expect(isDrawingPath('boards/a.md')).toBe(false)
    expect(isDrawingPath('boards/excalidraw.md')).toBe(false)
  })
})

describe('drawingChoices', () => {
  it('offers the drawing already on screen first', () => {
    const choices = drawingChoices({ files, open: ['boards/open.excalidraw.md'], recent: [] })
    expect(choices[0]).toMatchObject({ path: 'boards/open.excalidraw.md', reason: 'open' })
  })

  it('then the ones read recently, in the order they were read', () => {
    const choices = drawingChoices({
      files,
      open: [],
      recent: ['boards/read.excalidraw.md', 'boards/old.excalidraw.md'],
    })
    expect(choices.slice(0, 2)).toMatchObject([
      { path: 'boards/read.excalidraw.md', reason: 'recent' },
      { path: 'boards/old.excalidraw.md', reason: 'recent' },
    ])
  })

  it('then everything else, most recently written first', () => {
    const choices = drawingChoices({ files, open: [], recent: [] })
    expect(choices.map(choice => choice.path)).toEqual([
      'boards/fresh.excalidraw.md',
      'boards/open.excalidraw.md',
      'boards/old.excalidraw.md',
      'boards/read.excalidraw.md',
    ])
  })

  it('names each drawing once, however many reasons it has to be offered', () => {
    const choices = drawingChoices({
      files,
      open: ['boards/fresh.excalidraw.md'],
      recent: ['boards/fresh.excalidraw.md', 'boards/old.excalidraw.md'],
    })
    expect(choices.map(choice => choice.path)).toEqual([
      'boards/fresh.excalidraw.md',
      'boards/old.excalidraw.md',
      'boards/open.excalidraw.md',
      'boards/read.excalidraw.md',
    ])
    expect(choices[0]?.reason).toBe('open')
  })

  it('ignores an open or recent path that is not a drawing in the vault', () => {
    const choices = drawingChoices({ files, open: ['notes/premise.md'], recent: ['notes/gone.excalidraw.md'] })
    expect(choices.map(choice => choice.path)).not.toContain('notes/premise.md')
    expect(choices.map(choice => choice.path)).not.toContain('notes/gone.excalidraw.md')
  })
})
