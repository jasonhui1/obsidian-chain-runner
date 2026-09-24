import { describe, expect, it } from 'vitest'
import { pickPanelIndexes } from '@/run/pickPanels'
import type { RunMeta } from '@/engine/types'

describe('pick panel positions', () => {
  it('finds the downstream output after an earlier answer filled every panel', () => {
    const run: RunMeta = { runId: 'source', chainName: 'chain', seedPrompt: '', startedAt: '', status: 'complete', agentOutputs: [], graph: { edges: [
      { fromNode: 'pick', toNode: 'world' },
      { fromNode: 'world', toNode: 'verdict' },
    ] } }
    const panels = [
      { name: 'Before', node: 'before', text: 'old', lines: 1, state: 'filled' as const },
      { name: 'World', node: 'world', text: 'first answer', lines: 1, state: 'filled' as const },
      { name: 'Verdict', node: 'verdict', text: 'first answer', lines: 1, state: 'filled' as const },
    ]
    expect(pickPanelIndexes(run, 'pick', panels)).toEqual([1, 2])
  })
})
