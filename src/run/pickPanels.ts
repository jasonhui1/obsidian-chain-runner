import type { LayoutPanel, RunMeta } from '../engine/types'

/** Outputs after a hold, even when an earlier answer has filled the source run. */
export function pickPanelIndexes(run: RunMeta, nodeId: string, panels: readonly LayoutPanel[]): number[] {
  const reached = new Set([nodeId])
  let changed = true
  while (changed) {
    changed = false
    for (const edge of run.graph?.edges ?? []) {
      if (reached.has(edge.fromNode) && !reached.has(edge.toNode)) {
        reached.add(edge.toNode)
        changed = true
      }
    }
  }
  reached.delete(nodeId)
  const downstream = panels.flatMap((panel, index) => reached.has(panel.node) ? [index] : [])
  return downstream.length > 0 ? downstream : panels.flatMap((panel, index) => panel.state === 'pending' ? [index] : [])
}
