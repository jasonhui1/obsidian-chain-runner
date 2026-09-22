// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { VarianceBoard } from '@/ui/varianceBoard'
import type { RunMeta, VarianceGroup, VarianceSample } from '@/engine/types'

let root: HTMLElement
let openedGroups: string[]
let board: VarianceBoard

const run = (runId: string, index: number, size = 3): RunMeta => ({
  runId,
  chainName: 'Relay',
  seedPrompt: 'seed',
  startedAt: 'now',
  status: 'complete',
  agentOutputs: [{ agentName: `Writer ${index + 1}`, nodeId: 'writer', output: `member ${index + 1}`, status: 'success', timestamp: 'now' }],
  variance: { groupId: 'group-1', index, size },
})

const sample = (runId: string, runIndex: number, output: string, status: VarianceSample['status'] = 'success'): VarianceSample => ({
  runId,
  runIndex,
  output,
  status,
})

function group(over: Partial<VarianceGroup> = {}): VarianceGroup {
  return {
    groupId: 'group-1',
    chainName: 'Relay',
    seedPrompt: 'seed',
    expectedRunCount: 3,
    completedRunCount: 2,
    costWarning: 'one or more runs contain unpriced output',
    runs: [run('r0', 0), run('r1', 1), run('r2', 2)],
    nodes: [
      {
        nodeId: 'writer',
        nodeName: 'Writer',
        successfulSampleCount: 2,
        expectedSampleCount: 3,
        samples: [sample('r0', 0, 'first\nfull output'), sample('r1', 1, 'failed', 'error'), sample('r2', 2, 'second\nfull output')],
      },
    ],
    ...over,
  }
}

beforeEach(() => {
  root = document.createElement('div')
  document.body.replaceChildren(root)
  openedGroups = []
  board = new VarianceBoard(root, { openGroup: groupId => openedGroups.push(groupId) })
})

describe('variance summary', () => {
  it('shows incomplete spread and the engine cost warning without inventing zeroes', () => {
    board.showGroup(group())

    expect(root.textContent).toContain('2 of 3 runs completed')
    expect(root.textContent).toContain('Spread unavailable')
    expect(root.textContent).toContain('one or more runs contain unpriced output')
    expect(root.textContent).not.toContain('$0.00')
  })

  it('shows engine-provided zero spread and zero cost as real values', () => {
    board.showGroup(group({
      completedRunCount: 3,
      costWarning: undefined,
      costUsd: 0,
      nodes: [{
        nodeId: 'writer',
        nodeName: 'Writer',
        spread: 0,
        successfulSampleCount: 3,
        expectedSampleCount: 3,
        samples: [sample('r0', 0, 'same'), sample('r1', 1, 'same'), sample('r2', 2, 'same')],
      }],
    }))

    expect(root.textContent).toContain('Spread 0')
    expect(root.textContent).toContain('$0.00')
    expect(root.textContent).not.toContain('Spread unavailable')
  })

  it('preserves small nonzero engine spreads instead of rounding them to zero', () => {
    board.showGroup(group({
      nodes: [{
        nodeId: 'writer',
        nodeName: 'Writer',
        spread: 0.004,
        successfulSampleCount: 3,
        expectedSampleCount: 3,
        samples: [sample('r0', 0, 'same'), sample('r1', 1, 'close'), sample('r2', 2, 'close')],
      }],
    }))

    expect(root.querySelector('[data-node-id="writer"]')?.textContent).toBe('Writer · Spread 0.004')
  })

  it('lets a reader choose two successful samples and shows each full output side by side', () => {
    board.showGroup(group({
      expectedRunCount: 4,
      completedRunCount: 4,
      runs: [run('r0', 0, 4), run('r1', 1, 4), run('r2', 2, 4), run('r3', 3, 4)],
      nodes: [{
        nodeId: 'writer',
        nodeName: 'Writer',
        spread: 0.5,
        successfulSampleCount: 3,
        expectedSampleCount: 4,
        samples: [
          sample('r0', 0, 'first\nfull output'),
          sample('r1', 1, 'failed sample', 'error'),
          sample('r2', 2, 'middle output'),
          sample('r3', 3, 'last\nfull output'),
        ],
      }, {
        nodeId: 'editor',
        nodeName: 'Editor',
        spread: 0.25,
        successfulSampleCount: 2,
        expectedSampleCount: 3,
        samples: [sample('r0', 0, 'editor first'), sample('r2', 2, 'editor second')],
      }],
    }))

    const left = root.querySelector<HTMLSelectElement>('[aria-label="First run"]')!
    const right = root.querySelector<HTMLSelectElement>('[aria-label="Second run"]')!
    expect(Array.from(left.options, option => option.value)).toEqual(['r0', 'r2', 'r3'])
    expect(Array.from(right.options, option => option.value)).toEqual(['r0', 'r2', 'r3'])
    expect(root.querySelector('.chain-runner-variance-output--left')?.textContent).toBe('first\nfull output')
    expect(root.querySelector('.chain-runner-variance-output--right')?.textContent).toBe('middle output')

    left.value = 'r3'
    left.dispatchEvent(new Event('change'))

    expect(root.querySelector('.chain-runner-variance-output--left')?.textContent).toBe('last\nfull output')
    expect(root.querySelector('.chain-runner-variance-output--right')?.textContent).toBe('middle output')

    root.querySelector<HTMLButtonElement>('[data-node-id="editor"]')!.click()
    expect(root.querySelectorAll('.chain-runner-variance-section-title')[1]?.textContent).toBe('Compare Editor')
    expect(root.querySelector('.chain-runner-variance-output--left')?.textContent).toBe('editor first')
    expect(root.querySelector('.chain-runner-variance-output--right')?.textContent).toBe('editor second')
  })

  it('opens a member run and lets that run reopen its variance group', () => {
    board.showGroup(group())
    root.querySelector<HTMLButtonElement>('[data-member-run="r1"]')!.click()

    expect(root.textContent).toContain('member 2')
    root.querySelector<HTMLButtonElement>('[data-open-variance-group]')!.click()
    expect(openedGroups).toEqual(['group-1'])
  })
})
