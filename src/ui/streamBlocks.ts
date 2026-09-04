/**
 * The split a streaming answer is rendered by: complete blocks that have settled,
 * then one tail that is still being written (ADR-0008). Pure, so the boundary
 * rule is checkable without a DOM.
 */

/** An opening or closing fence line: up to three spaces, then three or more marks. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * `text` as blocks that join back into it. A block ends at a blank line outside a
 * fence, which stays with the block it closes; the last block is whatever is left,
 * and a caller streaming should treat it as still growing.
 */
export function splitBlocks(text: string): string[] {
  if (text === '') return []
  const blocks: string[] = []
  let block = ''
  let fence: string | undefined
  /** The current block has met its blank line, so the next non-blank line starts a new one. */
  let closed = false

  for (const line of text.split(/(?<=\n)/)) {
    if (closed && line.trim() !== '') {
      blocks.push(block)
      block = ''
      closed = false
    }
    block += line

    const mark = FENCE.exec(line)?.[1]
    if (fence === undefined) fence = mark
    else if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = undefined

    if (fence === undefined && line.trim() === '') closed = true
  }

  blocks.push(block)
  return blocks
}
