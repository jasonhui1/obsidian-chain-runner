/**
 * Which drawings the "send to drawing" suggester offers, and in what order.
 *
 * The ticket asks for "an open or recent drawing", which is an ordering
 * decision and not a vault one — so it is made here, without Obsidian, and the
 * adapter above is left holding only the vault reads that feed it.
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
 * Excalidraw's two file shapes. A compressed drawing is a markdown note with a
 * doubled extension; the older form is the bare `.excalidraw`. The plugin can
 * also mark an ordinary note as a drawing in its frontmatter, which a path
 * cannot see — the caller adds those.
 */
export function isDrawingPath(path: string): boolean {
  return /[^/]\.excalidraw(\.md)?$/.test(path)
}

/**
 * The drawings to offer: the ones on screen, then the ones read recently in the
 * order they were read, then the rest newest-written first.
 *
 * A drawing named twice is offered once, under the strongest reason it has —
 * the reader is picking a drawing, not a reason, and a list that repeats one is
 * a list they have to read twice.
 */
export function drawingChoices(input: { files: DrawingFile[]; open: string[]; recent: string[] }): DrawingChoice[] {
  const byPath = new Map(input.files.map(file => [file.path, file]))
  const chosen: DrawingChoice[] = []
  const taken = new Set<string>()

  const take = (paths: string[], reason: DrawingReason): void => {
    for (const path of paths) {
      const file = byPath.get(path)
      // An open tab or a recent path can name something that is not a drawing,
      // or a drawing that has since been deleted; the vault's list is the truth.
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
