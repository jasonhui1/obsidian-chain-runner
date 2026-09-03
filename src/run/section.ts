/**
 * Section addressing, ported from the engine's `lib/graph.ts` — a port may name a
 * section of a node's output, and both sides must resolve the name alike.
 */

export function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * The body of the markdown section whose heading slug-matches `name`, from after
 * the heading line to the next heading of any level. Empty when there is none.
 */
export function extractSection(markdown: string, name: string): string {
  const target = slugify(name)
  const heading = /^#{1,6}\s+(.+?)\s*$/gm
  const heads: { slug: string; bodyStart: number; headStart: number }[] = []
  let match: RegExpExecArray | null
  while ((match = heading.exec(markdown)) !== null) {
    heads.push({ slug: slugify(match[1]), bodyStart: heading.lastIndex, headStart: match.index })
  }
  for (let i = 0; i < heads.length; i++) {
    if (heads[i].slug !== target) continue
    const end = i + 1 < heads.length ? heads[i + 1].headStart : markdown.length
    return markdown.slice(heads[i].bodyStart, end).trim()
  }
  return ''
}
