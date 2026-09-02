/**
 * The slice of Obsidian the quick path touches, standing in for the real module
 * at test time (aliased in `vitest.config.ts`).
 *
 * `src/run/` is checked without a vault because it imports nothing from
 * Obsidian. `src/ui/quickRun.ts` is the seam where the two meet, and its
 * decisions — which note, how much of it, whether to ask for the dropdown — are
 * the ticket's acceptance criteria. This is the smallest thing that lets them be
 * driven: modals that record themselves on open instead of drawing, so a test
 * can answer them the way a reader would.
 *
 * Typechecking still runs against the real `obsidian` types; only the runtime is
 * substituted, so a stub that drifts from the real API fails `tsc`.
 */

/** Every modal opened since `resetModals`, oldest first. */
export const openedModals: OpenModal[] = []

/** A modal on screen, as a test answers it. */
export interface OpenModal {
  placeholder: string
  /** Answers it the way arrowing to a row and pressing enter would. */
  choose(index: number, query?: string): void
}

export function resetModals(): void {
  openedModals.length = 0
}

export function lastModal(): OpenModal | undefined {
  return openedModals[openedModals.length - 1]
}

class BaseModal {
  placeholder = ''
  emptyStateText = ''
  limit = 0

  constructor(readonly app: unknown) {}

  setPlaceholder(placeholder: string): void {
    this.placeholder = placeholder
  }

  open(): void {
    openedModals.push(this as unknown as OpenModal)
  }

  close(): void {}
}

export class SuggestModal<T> extends BaseModal {
  choose(index: number, query = ''): void {
    const rows = (this as unknown as { getSuggestions(q: string): T[] }).getSuggestions(query)
    const row = rows[index]
    if (row === undefined) throw new Error(`no suggestion at ${index}`)
    ;(this as unknown as { onChooseSuggestion(row: T, evt: unknown): void }).onChooseSuggestion(row, {})
  }
}

export class FuzzySuggestModal<T> extends BaseModal {
  choose(index: number): void {
    const items = (this as unknown as { getItems(): T[] }).getItems()
    const item = items[index]
    if (item === undefined) throw new Error(`no item at ${index}`)
    ;(this as unknown as { onChooseItem(item: T, evt: unknown): void }).onChooseItem(item, {})
  }
}

/** The real one scores a match; the picker's own ordering is tested elsewhere. */
export function prepareFuzzySearch(query: string): (text: string) => { score: number } | null {
  return text => (text.toLowerCase().includes(query.toLowerCase()) ? { score: 0 } : null)
}

export class App {}
export class TFile {
  path = ''
  name = ''
  basename = ''
  extension = 'md'
  stat = { ctime: 0, mtime: 0, size: 0 }
}
export class TFolder {
  path = ''
  name = ''
}
export class MarkdownView {}

/** Obsidian's own path tidy, narrowed to what the vault writes go through. */
export function normalizePath(path: string): string {
  return path.replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '')
}
