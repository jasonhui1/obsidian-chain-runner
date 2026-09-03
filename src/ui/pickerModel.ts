import { momentOf, type ChainPurpose, type ChainSummary } from '../engine/types'

/**
 * What the chain picker shows, and in what order, so the modal is left with
 * drawing only. The four headings are the engine's own (ADR-0016); unlike the
 * playground's picker, an empty heading is dropped rather than drawn.
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
  /** Whether the note reaches the chain at all; an unseeded one reads the files it pins. */
  readsNote: boolean
}

/**
 * A hit in the name outranks the same hit beneath it. Every field is searched:
 * the moment is often the only part of a chain anyone remembers.
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



/**
 * The picker's rows: groups in heading order, best match first within a group.
 * Group order wins over score, so headings never reshuffle as the reader types.
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
    // Unsorted leaves an unqueried list in workspace order, as the playground shows it.
    if (match) group.sort((a, b) => b.score - a.score)
    return group.map(({ chain }, index) => ({
      chain,
      heading,
      groupStart: index === 0,
      note: momentOf(chain),
      // A workspace too old to report its nodes says nothing; assume seeded.
      readsNote: chain.seeded !== false,
    }))
  })
}
