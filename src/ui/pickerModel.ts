import type { ChainPurpose, ChainSummary } from '../engine/types'

/**
 * What the chain picker shows, and in what order — decided here so the modal is
 * left with drawing only.
 *
 * The four headings and their order are the engine's own (ADR-0016): a chain
 * declares which group it belongs to, and one that declares nothing sits under
 * the fourth rather than inside a group it never chose. The one departure from
 * the playground's picker is that an empty heading is dropped rather than drawn:
 * a modal filtered to two results has no room to say what it has none of.
 */
export const PURPOSE_HEADINGS: { heading: string; purpose?: ChainPurpose }[] = [
  { heading: '洞見 (insight)', purpose: 'insight' },
  { heading: '產出 (production)', purpose: 'production' },
  { heading: '壓力測試 (stress-test)', purpose: 'stress-test' },
  { heading: 'unclassified' },
]

/** How well one field matched what was typed; `null` when it did not. */
export type Matcher = (text: string) => number | null

/** Builds a matcher for a query — Obsidian's `prepareFuzzySearch` at runtime. */
export type FuzzySearch = (query: string) => Matcher

export interface PickerRow {
  chain: ChainSummary
  heading: string
  /** True on the first row under its heading, which is where the heading is drawn. */
  groupStart: boolean
  /** The situation the chain is for; its description when it states no moment. */
  note: string
}

/**
 * The name is what a reader is most likely typing, so a hit there outranks the
 * same hit in the sentence beneath it. Every field is searched, though: the
 * moment is often the only part of a chain anyone remembers.
 */
function scoreOf(chain: ChainSummary, match: Matcher): number | null {
  const fields: [string | undefined, number][] = [
    [chain.name, 2],
    [chain.slug, 1],
    [chain.moment, 1],
    [chain.description, 0.5],
  ]
  let best: number | null = null
  for (const [text, weight] of fields) {
    if (!text) continue
    const score = match(text)
    if (score === null) continue
    const weighted = score * weight
    if (best === null || weighted > best) best = weighted
  }
  return best
}

function noteOf(chain: ChainSummary): string {
  return chain.moment || chain.description || ''
}

/**
 * The picker's rows for what was typed: groups in heading order, and within a
 * group the best match first. Group order wins over score — headings that
 * reshuffled as the reader typed would cost more than a better ranking buys.
 */
export function pickerRows(chains: ChainSummary[], query: string, fuzzy: FuzzySearch): PickerRow[] {
  const trimmed = query.trim()
  const match = trimmed === '' ? undefined : fuzzy(trimmed)

  const scored = chains.flatMap(chain => {
    if (!match) return [{ chain, score: 0 }]
    const score = scoreOf(chain, match)
    return score === null ? [] : [{ chain, score }]
  })

  return PURPOSE_HEADINGS.flatMap(({ heading, purpose }) => {
    const group = scored.filter(({ chain }) => (purpose ? chain.purpose === purpose : !chain.purpose))
    // A stable sort leaves an unqueried list in workspace order, which is the
    // order the playground's own picker shows.
    if (match) group.sort((a, b) => b.score - a.score)
    return group.map(({ chain }, index) => ({
      chain,
      heading,
      groupStart: index === 0,
      note: noteOf(chain),
    }))
  })
}
