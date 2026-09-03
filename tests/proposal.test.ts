import { describe, it, expect } from 'vitest'
import {
  ACCEPT_LINK,
  DISMISS_LINK,
  ACCEPTED_STROKE,
  ACCEPTED_STROKE_STYLE,
  PROPOSAL_STROKE,
  PROPOSAL_STROKE_STYLE,
  acceptEdits,
  buildProposalLabels,
  dismissEdits,
  proposalData,
  type MaybeProposalElement,
  type ProposalData,
} from '@/ui/proposal'
import { buildChainNode } from '@/ui/chainNode'
import type { Box } from '@/ui/nodeScene'

/** What a proposal is, and what accepting or dismissing one changes. */

const card: Box = { x: 500, y: 300, width: 300, height: 200 }

const identity = { proposalId: 'p-1', chainName: 'Five Personas', runId: 'r-9', notePath: 'chains/runs/r-9/Optimist.md' }

const stamp = (over: Partial<ProposalData> = {}): { chainRunnerProposal: ProposalData } => ({
  chainRunnerProposal: { ...identity, role: 'card', ...over },
})

/** One element of some proposal on a scene. */
const element = (id: string, over: Partial<ProposalData> = {}): MaybeProposalElement & { id: string } => ({
  id,
  customData: stamp(over),
})

const ids = (elements: { id: string }[]): string[] => elements.map(one => one.id).sort()

describe('buildProposalLabels', () => {
  const labels = buildProposalLabels(card, identity)

  it('offers exactly accept and dismiss', () => {
    expect(labels.map(label => label.role)).toEqual(['accept', 'dismiss'])
  })

  it('makes each one clickable, by its own link', () => {
    expect(labels.map(label => label.link)).toEqual([ACCEPT_LINK, DISMISS_LINK])
  })

  it('sits them under the card, within its width', () => {
    for (const label of labels) {
      expect(label.y).toBeGreaterThanOrEqual(card.y + card.height)
      expect(label.x).toBeGreaterThanOrEqual(card.x)
      expect(label.x + label.width).toBeLessThanOrEqual(card.x + card.width)
    }
  })

  it('does not overlap them', () => {
    const [accept, dismiss] = labels
    expect(dismiss!.x).toBeGreaterThanOrEqual(accept!.x + accept!.width)
  })

  it('stamps both with the proposal and the note behind it', () => {
    for (const label of labels) {
      expect(label.customData.chainRunnerProposal).toMatchObject(identity)
    }
  })
})

describe('proposalData', () => {
  it('reads a proposal`s own stamp back', () => {
    expect(proposalData(element('a'))).toMatchObject({ ...identity, role: 'card' })
  })

  it('is not fooled by a chain node', () => {
    for (const one of buildChainNode({ slug: 'relay', name: 'Relay' }, { nodeId: 'n-1' })) {
      expect(proposalData(one)).toBeUndefined()
    }
  })

  it('refuses a stamp missing what it needs', () => {
    expect(proposalData({ customData: { chainRunnerProposal: { proposalId: 'p-1' } } })).toBeUndefined()
    expect(proposalData({ customData: { chainRunnerProposal: { ...identity, role: 'nonsense' } } })).toBeUndefined()
    expect(proposalData({ customData: 'not an object' })).toBeUndefined()
    expect(proposalData({})).toBeUndefined()
  })
})

describe('acceptEdits', () => {
  const scene = [
    element('card', { role: 'card' }),
    element('link', { role: 'link' }),
    element('accept', { role: 'accept' }),
    element('dismiss', { role: 'dismiss' }),
    element('other', { role: 'card', proposalId: 'p-2' }),
    { id: 'drawn-by-hand' },
  ]

  const edits = acceptEdits(scene, 'p-1')

  it('keeps the card and its connector, as ordinary material', () => {
    expect(ids(edits.normalise)).toEqual(['card', 'link'])
  })

  it('takes the two labels away, so an accepted proposal has nothing left to click', () => {
    expect(ids(edits.remove)).toEqual(['accept', 'dismiss'])
  })

  it('leaves another proposal and the reader`s own drawing alone', () => {
    expect(ids([...edits.normalise, ...edits.remove])).not.toContain('other')
    expect(ids([...edits.normalise, ...edits.remove])).not.toContain('drawn-by-hand')
  })

  it('does nothing for a proposal that is no longer there', () => {
    expect(acceptEdits(scene, 'p-404')).toEqual({ normalise: [], remove: [] })
  })
})

describe('dismissEdits', () => {
  const scene = [
    element('card', { role: 'card' }),
    element('link', { role: 'link' }),
    element('accept', { role: 'accept' }),
    element('dismiss', { role: 'dismiss' }),
    element('other', { role: 'card', proposalId: 'p-2' }),
  ]

  it('takes the whole proposal off the drawing', () => {
    const edits = dismissEdits(scene, 'p-1')
    expect(edits.normalise).toEqual([])
    expect(ids(edits.remove)).toEqual(['accept', 'card', 'dismiss', 'link'])
  })

  it('leaves the other proposal standing', () => {
    expect(ids(dismissEdits(scene, 'p-2').remove)).toEqual(['other'])
  })
})

describe('the two styles', () => {
  it('differ, so a proposal cannot be read as accepted material', () => {
    expect(PROPOSAL_STROKE).not.toBe(ACCEPTED_STROKE)
    expect(PROPOSAL_STROKE_STYLE).not.toBe(ACCEPTED_STROKE_STYLE)
  })
})
