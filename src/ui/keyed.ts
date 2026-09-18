export interface KeyedOptions {
  /** Makes an element for a key; `use` can say instead, for a set whose elements differ. */
  make?: (key: string) => HTMLElement
  /** Every element a draw drops, so whatever hangs off it is released with it. */
  onRemove?: (key: string, el: HTMLElement) => void
}

/**
 * Elements held by key across draws: a draw uses the keys it still wants, and
 * `end` drops the rest (ADR-0007). An element already in the right place is left
 * alone — moving one would drop the focus a reader has on it.
 */
export class KeyedChildren {
  private readonly els = new Map<string, HTMLElement>()
  private readonly used = new Set<string>()
  /** The last element this draw placed in each parent, which the next follows. */
  private readonly tails = new Map<HTMLElement, HTMLElement>()

  constructor(private readonly options: KeyedOptions) {}

  /** The element for `key`, made by `make` if this draw is its first, placed in `parent`. */
  use(key: string, parent: HTMLElement, make = this.options.make): { el: HTMLElement; fresh: boolean } {
    const known = this.els.get(key)
    const el = known ?? made(key, make)
    if (!known) this.els.set(key, el)
    this.used.add(key)
    const after = this.tails.get(parent)
    if (el.parentElement !== parent || el.previousElementSibling !== (after ?? null)) {
      parent.insertBefore(el, after ? after.nextSibling : parent.firstChild)
    }
    this.tails.set(parent, el)
    return { el, fresh: !known }
  }

  /** Ends the draw, dropping every element it did not use. */
  end(): void {
    for (const [key, el] of this.els) {
      if (this.used.has(key)) continue
      this.els.delete(key)
      el.remove()
      this.options.onRemove?.(key, el)
    }
    this.used.clear()
    this.tails.clear()
  }

  /** Drops everything, for a redraw that can reuse none of it. */
  clear(): void {
    this.used.clear()
    this.end()
  }
}

function made(key: string, make: KeyedOptions['make']): HTMLElement {
  if (!make) throw new Error(`nothing makes the element for ${key}`)
  return make(key)
}
