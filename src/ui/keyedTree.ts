import { KeyedChildren } from './keyed'

/**
 * A whole panel drawn by key (ADR-0007): an element's key is its path from the
 * root, named by the caller or, unnamed, by its kind and how many of that kind its
 * parent has had this draw. What an element holds beyond the DOM is let go of with it.
 */
export class KeyedTree {
  private readonly keyed = new KeyedChildren({ onRemove: (_key, el) => this.unbind(el) })
  private readonly paths = new WeakMap<HTMLElement, string>()
  private readonly counts = new Map<string, number>()
  private readonly bound = new Map<HTMLElement, (() => void)[]>()
  private readonly acts = new WeakMap<HTMLElement, () => void>()

  /** The `tag` element under `key` in `parent`, made with `cls` on the draw that first wants it. */
  place<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls = '', key?: string): { el: HTMLElementTagNameMap[K]; fresh: boolean } {
    const make = (): HTMLElementTagNameMap[K] => {
      const el = parent.ownerDocument.createElement(tag)
      if (cls) el.className = cls
      return el
    }
    const { el, fresh } = this.use(parent, key ?? this.nth(parent, `${tag}.${cls}`), make)
    // A key names one kind of element, so what `make` made is what comes back.
    return { el: el as HTMLElementTagNameMap[K], fresh }
  }

  /** The element under `key` in `parent`, made by `make` on the draw that first wants it. */
  use(parent: HTMLElement, key: string, make: () => HTMLElement): { el: HTMLElement; fresh: boolean } {
    const path = `${this.paths.get(parent) ?? ''}/${key}`
    const placed = this.keyed.use(path, parent, make)
    this.paths.set(placed.el, path)
    return placed
  }

  /** Ends the draw, dropping every element it did not place. */
  end(): void {
    this.keyed.end()
    this.counts.clear()
  }

  /** Lets go of `release` when `el` leaves the tree, or on `unbind`. */
  bind(el: HTMLElement, release: () => void): void {
    this.bound.set(el, [...(this.bound.get(el) ?? []), release])
  }

  unbind(el: HTMLElement): void {
    this.bound.get(el)?.forEach(release => release())
    this.bound.delete(el)
  }

  /** Makes `act` what `el` does now; the function answered does whatever the latest draw said, for a timer or watcher that outlives one. */
  latest(el: HTMLElement, act: () => void): () => void {
    this.acts.set(el, act)
    return () => this.acts.get(el)?.()
  }

  private nth(parent: HTMLElement, kind: string): string {
    const counted = `${this.paths.get(parent) ?? ''}/${kind}`
    const n = this.counts.get(counted) ?? 0
    this.counts.set(counted, n + 1)
    return `${kind}#${n}`
  }
}
