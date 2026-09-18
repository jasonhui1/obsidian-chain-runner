import type { App } from 'obsidian'
import { ChainPicker, ParameterPicker } from './chainPicker'
import type { BlockReading, DrawingView, PlacedProposal, ProposalDrawing, ProposalSurface } from './excalidraw'
import { SELECT_ONE_BLOCK } from './excalidraw'
import { seedFromInputs } from './inputSeed'
import type { NoteStore } from './noteStore'
import type { OutputNotes } from './outputNotes'
import { onDrawing, readDrawing } from './onDrawing'
import { proposalData, type MaybeProposalElement } from './proposal'
import { buildProposalFan, type ProposedPanel } from './proposalFan'
import { runIntoNotes } from './chainRun'
import { openLiveOutputs, type LiveOutput } from './liveOutputs'
import type { RunLayout } from '../run/panels'
import { runFailure } from '../run/session'
import { streamsOutputs, UNSUPPORTED_STREAMING } from '../run/stream'
import type { EngineClient } from '../engine/client'
import { parameterToAsk, type ChainSummary } from '../engine/types'

/**
 * Expand: a chain proposes branches off one block of a drawing, and each lands
 * as a greyed, dashed card the reader keeps or drops. The chain is the reader's
 * pick, so none has to be named here (#12); the cards are ordinary output notes,
 * so a kept one still carries the run that wrote it (ADR-0003, ADR-0004).
 */

export const NOTHING_TO_EXPAND = 'That block says nothing to expand.'

export const NO_PROPOSALS = 'The chain proposed nothing.'

export const NO_CHAINS = 'No chains in the workspace'

export const ALREADY_EXPANDING = 'That block is already being expanded.'

export const PROPOSAL_GONE = 'That proposal is no longer on this drawing.'

export const SELECT_A_PROPOSAL = 'Select a proposal on the drawing to keep or drop it.'

export const EXPANDING = (chainName: string): string => `Expanding with ${chainName}…`

export interface ExpandDeps {
  /** For the chain and parameter pickers. */
  app: App
  store: NoteStore
  engine: EngineClient
  /** Offline is a notice and nothing else. */
  withEngine: <T>(action: () => Promise<T>) => Promise<T | undefined>
  notify: (message: string) => void
  markOffline: () => void
  /** Writes the hold note of a run that reached a hold. */
  holdReached: (runId: string, nodeId: string) => Promise<void>
  surface: ProposalSurface
  notes: OutputNotes
  /** A fresh identity for a proposal, injected so what is placed is checkable. */
  newProposalId: () => string
}

/** The block an expansion grows from, and the drawing it was read off. */
interface Source {
  drawing: ProposalDrawing
  block: BlockReading
}

export class Expand {
  /** One expansion per block. A second click while it runs is not a second run. */
  private readonly inFlight = new Map<string, AbortController>()

  constructor(private readonly deps: ExpandDeps) {}

  /** The "Expand this block" command. */
  async start(): Promise<void> {
    const unavailable = this.deps.surface.unavailable()
    if (unavailable) {
      this.deps.notify(unavailable)
      return
    }

    // Bound now, so the proposals land on this drawing even if the reader moves on.
    const drawing = readDrawing(() => this.deps.surface.on(), this.deps.notify)
    if (!drawing) return
    const block = this.read(drawing)
    if (!block) return
    if (this.inFlight.has(block.id)) {
      this.deps.notify(ALREADY_EXPANDING)
      return
    }

    const chains = await this.deps.withEngine(() => this.deps.engine.listChains())
    if (!chains) return
    const capabilities = await this.deps.engine.capabilities()
    if (!streamsOutputs(capabilities)) {
      this.deps.notify(UNSUPPORTED_STREAMING)
      return
    }
    if (chains.length === 0) {
      this.deps.notify(NO_CHAINS)
      return
    }

    new ChainPicker(this.deps.app, chains, chain => this.pick(chain, { drawing, block }), {
      placeholder: 'Expand this block with which chain?',
      unseeded: 'reads its own files — this block is not used',
    }).open()
  }

  /** Drops every expansion in flight — the plugin is unloading. */
  stop(): void {
    for (const controller of this.inFlight.values()) controller.abort()
    this.inFlight.clear()
  }

  /**
   * A click on a proposal's `✓ Keep` or `✕ Drop`. `false` swallows the link, the
   * way a chain node's own lines are swallowed (`docs/spike-ea.md`, Q1).
   */
  handleLinkClick(element: MaybeProposalElement, view?: DrawingView): boolean {
    const data = proposalData(element)
    // Not ours: a wiki link the reader drew themselves, and theirs to follow.
    if (!data) return true
    if (data.role === 'accept' || data.role === 'dismiss') {
      const drawing = readDrawing(() => this.deps.surface.on(view), this.deps.notify)
      if (drawing) void this.decide(drawing, data.proposalId, data.role, data.role === 'dismiss' ? data.notePath : undefined)
    }
    // A click on the card opens the note it shows, which is what a card is for.
    return data.role === 'card'
  }

  /**
   * The "Keep"/"Drop this proposal" commands. A link needs Ctrl/Cmd+Click
   * (`docs/spike-ea.md`, Q1), so the same two decisions are reachable from the
   * palette on whatever the reader has selected.
   */
  async decideSelected(action: 'accept' | 'dismiss'): Promise<void> {
    const unavailable = this.deps.surface.unavailable()
    if (unavailable) {
      this.deps.notify(unavailable)
      return
    }
    const drawing = readDrawing(() => this.deps.surface.on(), this.deps.notify)
    if (!drawing) return
    const data = readDrawing(() => drawing.selectedProposal(), this.deps.notify)
    if (!data) {
      this.deps.notify(SELECT_A_PROPOSAL)
      return
    }
    await this.decide(drawing, data.proposalId, action, action === 'dismiss' ? data.notePath : undefined)
  }

  /** Keeping or dropping a proposal; a dropped one takes its note with it. */
  private async decide(
    drawing: ProposalDrawing,
    proposalId: string,
    action: 'accept' | 'dismiss',
    notePath: string | undefined,
  ): Promise<void> {
    const edited = await this.onDrawing(() => drawing.editProposal(proposalId, action))
    // Only once the drawing is rid of it: a note trashed under a card still shown
    // would leave a dead embeddable.
    if (edited && notePath) await this.deps.notes.remove(notePath)
  }

  /** The block the reader picked out, or a notice and nothing. */
  private read(drawing: ProposalDrawing): BlockReading | undefined {
    const block = readDrawing(() => drawing.selection(), this.deps.notify)
    if (!block) this.deps.notify(SELECT_ONE_BLOCK)
    return block
  }

  /** Asks for the chain's dropdown first when it declares one. */
  private pick(chain: ChainSummary, source: Source): void {
    const parameter = parameterToAsk(chain)
    if (!parameter) {
      void this.launch(chain, source, undefined)
      return
    }
    new ParameterPicker(this.deps.app, parameter.name, parameter.options, value => {
      void this.launch(chain, source, value)
    }).open()
  }

  private async launch(chain: ChainSummary, source: Source, parameterValue: string | undefined): Promise<void> {
    const { block } = source
    const seed = await seedFromInputs({
      store: this.deps.store,
      notify: this.deps.notify,
      inputs: [block.input],
      drawing: block.drawing,
    })
    // A chain that pins its own files reads nothing from the block.
    if (seed === '' && chain.seeded !== false) {
      this.deps.notify(NOTHING_TO_EXPAND)
      return
    }

    // Claimed here rather than at the command: the picker is open in between.
    if (this.inFlight.has(block.id)) {
      this.deps.notify(ALREADY_EXPANDING)
      return
    }
    const controller = new AbortController()
    this.inFlight.set(block.id, controller)
    this.deps.notify(EXPANDING(chain.name))
    try {
      await this.stream(chain, source, seed, parameterValue, controller)
    } finally {
      if (this.inFlight.get(block.id) === controller) this.inFlight.delete(block.id)
    }
  }

  private async stream(
    chain: ChainSummary,
    source: Source,
    seed: string,
    parameterValue: string | undefined,
    controller: AbortController,
  ): Promise<void> {
    const outcome = await runIntoNotes({
      engine: this.deps.engine,
      chain,
      request: {
        chainName: chain.name,
        seedPrompt: seed,
        ...(parameterValue ? { paramValue: parameterValue } : {}),
      },
      signal: controller.signal,
      notify: this.deps.notify,
      markOffline: this.deps.markOffline,
      holdReached: this.deps.holdReached,
      place: (runId, layout) => this.propose(runId, layout, chain, source),
    })
    // Dropped by an unload: the cards stay as a record of a real run.
    if (outcome.aborted) return

    const error = runFailure(outcome.state)
    if (error && error !== outcome.failure) this.deps.notify(error)
    // An expansion has no line of its own to report on, so an empty one is a notice.
    if (!outcome.live?.length && !error) this.deps.notify(NO_PROPOSALS)
  }

  /** One empty note per proposal, placed as a greyed card. */
  private async propose(
    runId: string,
    layout: RunLayout,
    chain: ChainSummary,
    { drawing, block }: Source,
  ): Promise<LiveOutput<ProposedPanel>[]> {
    const fan = buildProposalFan({ layout, source: block.box })
    // A refused note has said so already; the rest of the run still lands.
    const outputs = await openLiveOutputs({
      places: fan,
      notes: this.deps.notes,
      run: { runId, chainName: chain.name },
    })
    if (outputs.length === 0) return outputs

    const proposals: PlacedProposal[] = outputs.map(one => ({
      box: one.place.box,
      notePath: one.note.path,
      identity: {
        proposalId: this.deps.newProposalId(),
        chainName: chain.name,
        runId,
        notePath: one.note.path,
      },
    }))
    await this.onDrawing(async () => {
      await drawing.placeProposals(proposals, block)
      return true
    })
    return outputs
  }

  /** Touches the drawing, saying so rather than throwing when it cannot. */
  private async onDrawing(action: () => Promise<boolean>): Promise<boolean> {
    const done = await onDrawing(action, this.deps.notify)
    if (done === false) this.deps.notify(PROPOSAL_GONE)
    return done === true
  }
}

/** A proposal's identity, made once when it is placed. Not an element id — those change on copy. */
export function newProposalId(): string {
  return `proposal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
