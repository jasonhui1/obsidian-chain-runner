import { CANON_CONTEXT_KEY } from './canon'
import type { AgentOutput, LayoutPanel, RunGraph, RunMeta, RunRequest } from '../engine/types'

/** Rerun-downstream: which of a finished run's outputs a new run replays, so only what a revision feeds executes again. */

/** A node and every node reachable from it along the graph's edges. */
export function descendants(graph: RunGraph, nodeId: string): Set<string> {
  const reached = new Set([nodeId])
  const queue = [nodeId]
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    for (const edge of graph.edges) {
      if (edge.fromNode !== at || reached.has(edge.toNode)) continue
      reached.add(edge.toNode)
      queue.push(edge.toNode)
    }
  }
  return reached
}

/** The panels a rerun writes again: those whose node has no output to replay. */
export function rerunningPanels(panels: LayoutPanel[], request: RunRequest): LayoutPanel[] {
  const replayed = new Set(request.branchOutputs?.map(output => output.nodeId))
  return panels.filter(panel => !replayed.has(panel.node))
}

/**
 * Replays every output outside the revised nodes' descendants, plus each
 * revision (keyed by node id) as its node's output — omitted, it would regenerate.
 */
export function rerunRequest(
  run: RunMeta,
  panels: LayoutPanel[],
  revisions: Record<string, string>,
  canon: string | undefined,
): RunRequest | undefined {
  const graph = run.graph
  if (!graph) return undefined

  const rerun = new Set(Object.keys(revisions).flatMap(nodeId => [...descendants(graph, nodeId)]))
  const branchOutputs = run.agentOutputs.flatMap((output): AgentOutput[] => {
    const nodeId = output.nodeId
    if (nodeId === undefined || !rerun.has(nodeId)) return [output]
    const revision = revisions[nodeId]
    if (revision === undefined) return []
    return [revised(output, panels.find(panel => panel.node === nodeId)?.text.trim() ?? '', revision)]
  })

  return {
    chainName: run.chainName,
    seedPrompt: run.seedPrompt,
    ...(run.parameter ? { paramValue: run.parameter.value } : {}),
    // A context node is read on every run, never replayed, so canon goes along.
    ...(canon !== undefined ? { context: { [CANON_CONTEXT_KEY]: canon } } : {}),
    branchedFromRunId: run.runId,
    branchOutputs,
  }
}

/**
 * The output with the panel's part swapped for the edit; a panel may show only
 * one section of what its node wrote. No thought: it reasoned toward the old text.
 * The engine logs a replayed output's metrics, so they stay, at zero: nothing ran.
 */
function revised(original: AgentOutput, shown: string, edit: string): AgentOutput {
  const at = shown === '' ? -1 : original.output.indexOf(shown)
  const output = at === -1 ? edit : original.output.slice(0, at) + edit + original.output.slice(at + shown.length)
  const kept: AgentOutput = { ...original, output, status: 'success', tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0 }
  delete kept.thought
  delete kept.error
  return kept
}
