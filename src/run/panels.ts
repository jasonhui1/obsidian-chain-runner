import { extractSection } from './section'
import type { AgentOutput, ChainSummary, LayoutKind, LayoutModel, LayoutPanel } from '../engine/types'

/**
 * The panels the view draws, from the panels the engine streams (ADR-0017). This
 * module adds only what the engine cannot know: half-written tokens, and what to
 * draw for a chain that declares no layout.
 */

/** A panel, plus what its node has written so far when nothing has settled yet. */
export interface RunPanel extends LayoutPanel {
  /** Tokens so far, scoped to this panel's socket; set only while it is `pending`. */
  streaming?: string
}

export interface RunLayout {
  kind: LayoutKind
  panels: RunPanel[]
}

/** What a run has produced so far, in the shapes the overlay and the fallback read. */
export interface RunNodes {
  /** Settled outputs, in the order the engine reported them. */
  outputs: AgentOutput[]
  /** Output tokens per node, for nodes that have started and not finished. */
  streaming: Record<string, string>
  /** Nodes in the order they started — the reading order of the trace fallback. */
  started: { nodeId: string; agentName: string }[]
}

export function emptyRunNodes(): RunNodes {
  return { outputs: [], streaming: {}, started: [] }
}

/**
 * The section to scope a node's partial text to, so it is not replaced by a
 * section of itself when it settles. A node feeding ports on different sections
 * has no single right answer, so its partial is shown raw.
 */
function socketFor(chain: ChainSummary, node: string): string | undefined {
  const sockets = new Set((chain.outputs ?? []).filter(port => port.node === node).map(port => port.socket))
  return sockets.size === 1 ? [...sockets][0] : undefined
}

function scoped(text: string, socket: string | undefined): string {
  if (!socket || socket === 'output') return text
  return extractSection(text, socket)
}

/** How much a panel holds, in the one count every surface shows. */
export function lineCount(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split('\n').length
}

/** Last write wins, which is what a trace panel shows for a node that ran twice. */
function byNode(outputs: AgentOutput[]): Map<string, AgentOutput> {
  const latest = new Map<string, AgentOutput>()
  for (const output of outputs) if (output.nodeId) latest.set(output.nodeId, output)
  return latest
}

/**
 * What a chain that declares no layout comes back as: one panel per node that
 * ran, in start order. The engine's `{ kind: 'undeclared', panels: [] }` is the
 * cue to fall back here, not a frame still to come.
 */
function tracePanels(run: RunNodes): RunPanel[] {
  const latest = byNode(run.outputs)
  return run.started.map(({ nodeId, agentName }) => {
    const output = latest.get(nodeId)
    const text = output?.output ?? ''
    const panel: RunPanel = {
      name: agentName,
      node: nodeId,
      text,
      lines: lineCount(text),
      state: stateOf(output, text),
    }
    if (panel.state === 'errored' && output?.error) panel.error = output.error
    const partial = run.streaming[nodeId]
    if (panel.state === 'pending' && partial) panel.streaming = partial
    return panel
  })
}

/** The trace fallback's outcome rule; a declared panel arrives with its state decided. */
function stateOf(output: AgentOutput | undefined, text: string): LayoutPanel['state'] {
  if (!output) return 'pending'
  if (output.status === 'error') return 'errored'
  if (output.status === 'skipped') return 'skipped'
  return text.trim() === '' ? 'empty' : 'filled'
}

/** Hands each still-pending panel whatever its node has written since it started. */
function overlay(model: LayoutModel, chain: ChainSummary, run: RunNodes): RunLayout {
  return {
    kind: model.kind,
    panels: model.panels.map(panel => {
      const partial = run.streaming[panel.node]
      if (panel.state !== 'pending' || !partial) return panel
      const text = scoped(partial, socketFor(chain, panel.node))
      return text === '' ? panel : { ...panel, streaming: text }
    }),
  }
}

/**
 * The panels to draw now: the engine's projection with live tokens over it, or
 * the run trace for a chain that declared no layout.
 */
export function buildRunPanels(chain: ChainSummary, model: LayoutModel | undefined, run: RunNodes): RunLayout {
  if (!model || model.kind === 'undeclared') return { kind: 'undeclared', panels: tracePanels(run) }
  return overlay(model, chain, run)
}
