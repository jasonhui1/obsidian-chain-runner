import { extractSection } from './section'
import type { AgentOutput, ChainSummary, ChainPort, LayoutKind, LayoutPanel, PanelState } from '../engine/types'

/**
 * The panels a run reads in, built here rather than fetched.
 *
 * `GET /api/runs/:id/layout` answers the same question, but only for a run
 * already written to disk — the quick path needs panels while the run is still
 * streaming. So the engine's `lib/layoutModel.ts` is ported: same ports, same
 * states, same emphasis, so a run opened in the playground afterwards shows the
 * shape it showed here. The one addition is `streaming`, below.
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

/** What a run has produced so far, in the three shapes the panels read. */
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
 * `output` is the whole text; any other socket names a section of it, resolved
 * the way an edge resolves — so a panel holds what the next hop received.
 */
function contentOf(text: string, socket: string | undefined): string {
  if (!socket || socket === 'output') return text
  return extractSection(text, socket)
}

function lineCount(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split('\n').length
}

/**
 * What a panel has to say about its node, read from the node's outcome before
 * its text. A hop that crashed and a hop that dropped the section its edge asked
 * for are different events, and only the second is `empty`.
 */
function stateOf(output: AgentOutput | undefined, text: string): PanelState {
  if (!output) return 'pending'
  if (output.status === 'error') return 'errored'
  if (output.status === 'skipped') return 'skipped'
  return text.trim() === '' ? 'empty' : 'filled'
}

function panelFor(
  name: string,
  socket: string | undefined,
  output: AgentOutput | undefined,
  streaming: string | undefined,
): RunPanel {
  const text = output ? contentOf(output.output, socket) : ''
  const state = stateOf(output, text)
  const panel: RunPanel = { name, text, lines: lineCount(text), state }
  if (state === 'errored' && output?.error) panel.error = output.error
  // Partial text goes through the same socket as settled text, so a panel never
  // shows a blob it will later replace with a section of itself.
  if (state === 'pending' && streaming) {
    const partial = contentOf(streaming, socket)
    if (partial !== '') panel.streaming = partial
  }
  return panel
}

function portPanel(port: ChainPort, output: AgentOutput | undefined, run: RunNodes, name = port.name): RunPanel {
  const panel = panelFor(name, port.socket, output, run.streaming[port.node])
  if (port.role === 'join') panel.emphasis = 'join'
  return panel
}

/** Last write wins: a node that reports twice shows where it ended up. */
function byNode(outputs: AgentOutput[]): Map<string, AgentOutput> {
  const latest = new Map<string, AgentOutput>()
  for (const output of outputs) if (output.nodeId) latest.set(output.nodeId, output)
  return latest
}

function portPanels(ports: ChainPort[], run: RunNodes): RunPanel[] {
  const latest = byNode(run.outputs)
  return ports.map(port => portPanel(port, latest.get(port.node), run))
}

/**
 * A loop-body node reports once per round, and under `view: sidebar` each round
 * is its own panel. A round reported twice — a retry — still collapses to its
 * last write. A port whose node is still on its first round gets the one live
 * panel, so the list is not empty while the loop is working.
 */
function roundPanels(ports: ChainPort[], run: RunNodes): RunPanel[] {
  return ports.flatMap(port => {
    const byRound = new Map<number, AgentOutput>()
    for (const output of run.outputs) {
      if (output.nodeId === port.node) byRound.set(output.round ?? 0, output)
    }
    if (byRound.size === 0) {
      return run.streaming[port.node] ? [{ ...portPanel(port, undefined, run), round: 0 }] : []
    }
    return [...byRound.keys()]
      .sort((a, b) => a - b)
      .map(round => ({
        ...portPanel(port, byRound.get(round), run, `${port.name} · round ${round + 1}`),
        round,
      }))
  })
}

/**
 * What a chain that declares no layout comes back as: one panel per node that
 * ran, in the order it started, showing the whole of what it produced. The
 * playground shows its run trace here; this is the same information in the shape
 * the rest of this view already speaks.
 */
function tracePanels(run: RunNodes): RunPanel[] {
  const latest = byNode(run.outputs)
  return run.started.map(({ nodeId, agentName }) =>
    panelFor(agentName, undefined, latest.get(nodeId), run.streaming[nodeId]),
  )
}

/**
 * Project a run onto the panels its chain declares. Reads `view` and `outputs`
 * only — never an edge, never a node kind.
 */
export function buildRunLayout(chain: ChainSummary, run: RunNodes): RunLayout {
  const ports = chain.outputs ?? []
  if (ports.length === 0) return { kind: 'undeclared', panels: tracePanels(run) }

  if (chain.view === 'timeline') {
    const panels = portPanels(ports, run)
    // The last hop is what survived the relay, whatever it holds.
    panels[panels.length - 1].emphasis = 'last'
    return { kind: 'timeline', panels }
  }
  // A columns chain with no `role: join` port renders its columns and nothing
  // beneath them — there is no "last panel" fallback here.
  if (chain.view === 'columns') return { kind: 'columns', panels: portPanels(ports, run) }
  if (chain.view === 'sidebar') return { kind: 'sidebar', panels: roundPanels(ports, run) }

  return { kind: 'undeclared', panels: tracePanels(run) }
}
