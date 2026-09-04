import { describe, it, expect } from 'vitest'
import { panelKeys } from '@/ui/panelKeys'
import type { RunPanel } from '@/run/panels'

/**
 * The key is what lets a draw find the element a panel already has, so what
 * matters is that it names the same panel across frames and never two at once.
 */

const panel = (over: Partial<RunPanel> = {}): RunPanel =>
  ({ name: 'hop 1', node: 'first', text: '', lines: 0, state: 'pending', ...over })

describe('panelKeys', () => {
  it('gives a panel the same key as it fills, since only its content changed', () => {
    const pending = panel({ node: 'first' })
    const filled = panel({ node: 'first', state: 'filled', text: 'landed', lines: 1 })
    expect(panelKeys([pending])).toEqual(panelKeys([filled]))
  })

  it('tells the rounds of a loop apart, though they share a node and a name', () => {
    const rounds = [panel({ round: 0 }), panel({ round: 1 }), panel({ round: 2 })]
    expect(new Set(panelKeys(rounds)).size).toBe(3)
  })

  it('holds a round to its key when an earlier round is still pending', () => {
    const first = panelKeys([panel({ round: 0 }), panel({ round: 1 })])
    const later = panelKeys([panel({ round: 0, state: 'filled' }), panel({ round: 1, state: 'filled' })])
    expect(later).toEqual(first)
  })

  it('numbers a repeat, for one node feeding two ports', () => {
    const keys = panelKeys([panel(), panel()])
    expect(keys[0]).not.toBe(keys[1])
  })

  it('tells two nodes apart under one name', () => {
    const keys = panelKeys([panel({ node: 'a' }), panel({ node: 'b' })])
    expect(keys[0]).not.toBe(keys[1])
  })
})
