import { describe, it, expect } from 'vitest'
import { splitBlocks } from '@/ui/streamBlocks'

/**
 * The split a streaming panel renders by (ADR-0008): everything but the last
 * block has settled, so what matters is where a boundary is *not* — inside a
 * fence — and that the pieces still add up to the text they came from.
 */

const joined = (text: string): string => splitBlocks(text).join('')

describe('splitBlocks', () => {
  it('gives nothing for no text', () => {
    expect(splitBlocks('')).toEqual([])
  })

  it('gives one block for text with no blank line', () => {
    expect(splitBlocks('a paragraph\nstill going')).toEqual(['a paragraph\nstill going'])
  })

  it('breaks on a blank line, keeping it with the block it closes', () => {
    expect(splitBlocks('first\n\nsecond')).toEqual(['first\n\n', 'second'])
  })

  it('keeps a run of blank lines with the block they close', () => {
    expect(splitBlocks('first\n\n\n\nsecond')).toEqual(['first\n\n\n\n', 'second'])
  })

  it('does not break inside a fence, so a half-written code block is whole', () => {
    const text = '```ts\nconst a = 1\n\nconst b = 2\n'
    expect(splitBlocks(text)).toEqual([text])
  })

  it('breaks again once the fence closes', () => {
    expect(splitBlocks('```\ncode\n\nmore\n```\n\nafter')).toEqual(['```\ncode\n\nmore\n```\n\n', 'after'])
  })

  it('reads a tilde fence, and does not let a backtick line close it', () => {
    const text = '~~~\n```\n\nstill code\n'
    expect(splitBlocks(text)).toEqual([text])
  })

  it('needs at least as many marks to close as opened', () => {
    const text = '````\n```\n\nstill code\n'
    expect(splitBlocks(text)).toEqual([text])
  })

  it('holds the last block back even when it is complete, since it can still grow', () => {
    expect(splitBlocks('done\n\nlist item')).toEqual(['done\n\n', 'list item'])
  })

  it('loses nothing: the blocks join back into the text', () => {
    for (const text of [
      'a\n\nb\n\nc',
      '# head\n\npara\n\n```\nfenced\n\nstill\n```\n\ntail',
      '\n\n\n',
      'no trailing newline',
      'trailing\n\n',
      '- one\n- two\n\n> quote',
    ]) {
      expect(joined(text)).toBe(text)
    }
  })

  it('grows only its last block as text arrives, so the settled prefix is stable', () => {
    const whole = 'first\n\nsecond half'
    const prefixes = Array.from({ length: whole.length }, (_, at) => whole.slice(0, at + 1))
    for (const prefix of prefixes.filter(text => text.length > 'first\n\n'.length)) {
      expect(splitBlocks(prefix)[0]).toBe('first\n\n')
    }
  })
})
