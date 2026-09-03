/**
 * Which drawings the "send to drawing" suggester offers, and in what order —
 * made here, without Obsidian, so `./excalidraw.ts` holds only the vault reads.
 */

/** A drawing in the vault, in the three facts the ordering reads. */
export interface DrawingFile {
  path: string
  name: string
  /** When the file was last written; the tiebreak for a drawing nobody has opened. */
  mtime: number
}

/** Why a drawing is being offered where it is — the suggester's second line. */
export type DrawingReason = 'open' | 'recent' | 'other'

export interface DrawingChoice extends DrawingFile {
  reason: DrawingReason
}

/**
 * Excalidraw's two file shapes: the doubled markdown extension, and the older
 * bare `.excalidraw`. A note marked as a drawing in frontmatter is the caller's.
 */
export function isDrawingPath(path: string): boolean {
  return /[^/]\.excalidraw(\.md)?$/.test(path)
}

/**
 * The drawings to offer: the ones on screen, then the recent ones in the order
 * they were read, then the rest newest first. One named twice is offered once,
 * under the strongest reason it has.
 */
export function drawingChoices(input: { files: DrawingFile[]; open: string[]; recent: string[] }): DrawingChoice[] {
  const byPath = new Map(input.files.map(file => [file.path, file]))
  const chosen: DrawingChoice[] = []
  const taken = new Set<string>()

  const take = (paths: string[], reason: DrawingReason): void => {
    for (const path of paths) {
      const file = byPath.get(path)
      // An open or recent path can name a non-drawing, or a deleted one.
      if (!file || taken.has(path)) continue
      taken.add(path)
      chosen.push({ ...file, reason })
    }
  }

  take(input.open, 'open')
  take(input.recent, 'recent')
  const rest = input.files.filter(file => !taken.has(file.path)).sort((a, b) => b.mtime - a.mtime)
  take(
    rest.map(file => file.path),
    'other',
  )
  return chosen
}
