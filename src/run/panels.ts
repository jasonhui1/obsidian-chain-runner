import { extractSection } from './section'
import type { AgentOutput, ChainSummary, LayoutKind, LayoutModel, LayoutPanel } from '../engine/types'

/**
 * The panels the view draws, from the panels the engine sent.
 *
 * The projection itself is not here and never will be: the engine streams its own
 * `buildLayoutModel` output on the run, one frame before the first hop and one
 * after every `agent_done` (ADR-0017). This module adds only the two things the
 * engine has no reason to know about — half-written tokens, and what to draw for
 * a chain that declares no layout at all.
 */

/** A panel, plus what its node has written so far when nothing has settled yet. */
export interface RunPanel extends LayoutPanel {
  /**
   * Tokens the node has produced, scoped to this panel's socket. Set only while
   * the panel is `pending`: a settled panel's `text` is the engine's own answer,
   * and the two never contradict each other.
   */
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
 * The section a node's partial text should be shown as, while it is still
 * writing.
 *
 * A panel carries its `node` but not its socket, and a node can feed two ports on
 * different sections. Where every port on the node agrees, the partial is scoped
 * the way the settled text will be, so a panel never shows a blob it then
 * replaces with a section of itself. Where they disagree there is no single right
 * answer, and the raw partial is shown rather than a guessed one.
 */
function socketFor(chain: ChainSummary, node: string): string | undefined {
  const sockets = new Set((chain.outputs ?? []).filter(port => port.node === node).map(port => port.socket))
  return sockets.size === 1 ? [...sockets][0] : undefined
}

function scoped(text: string, socket: string | undefined): string {
  if (!socket || socket === 'output') return text
  return extractSection(text, socket)
}

function lineCount(text: string): number {
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
 * ran, in the order it started, showing the whole of what it produced.
 *
 * The engine sends `{ kind: 'undeclared', panels: [] }` for these rather than
 * nothing at all, so this is a cue to fall back and not a frame still to come.
 * The playground shows its run trace here; this is the same information in the
 * shape the rest of the view already speaks.
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

/**
 * The trace fallback's own outcome rule. It exists only because the fallback is
 * the plugin's, not the engine's — every declared panel arrives with its state
 * already decided.
 */
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
 * The panels to draw now: the engine's own projection with live tokens laid over
 * it, or the run trace for a chain that declared no layout.
 *
 * `model` is absent only before the run's first frame arrives, which is also when
 * there is nothing to draw.
 */
export function buildRunPanels(chain: ChainSummary, model: LayoutModel | undefined, run: RunNodes): RunLayout {
  if (!model || model.kind === 'undeclared') return { kind: 'undeclared', panels: tracePanels(run) }
  return overlay(model, chain, run)
}
