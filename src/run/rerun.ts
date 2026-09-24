import { answer, type Answer, type OnEvent } from './answer'
import { CANON_CONTEXT_KEY } from './canon'
import type { EngineClient } from '../engine/client'
import type { ForkRequest, LayoutPanel, RunMeta } from '../engine/types'

export const UNSUPPORTED_FORK = 'This engine cannot rerun downstream. Update maestro-playground.'

/** The engine chooses what to replay; the plugin supplies whole revised outputs. */
export function rerunRequest(
  run: RunMeta,
  panels: LayoutPanel[],
  edits: Record<string, string>,
  canon: string | undefined,
  versions?: 'pinned',
): ForkRequest {
  const outputs = new Map(run.agentOutputs.filter(output => output.nodeId !== undefined).map(output => [output.nodeId, output.output]))
  const revisions = Object.fromEntries(Object.entries(edits).map(([nodeId, edit]) => {
    const original = outputs.get(nodeId) ?? ''
    const shown = panels.find(panel => panel.node === nodeId)?.text.trim() ?? ''
    return [nodeId, revised(original, shown, edit)]
  }))

  return {
    revisions,
    ...(canon !== undefined ? { context: { [CANON_CONTEXT_KEY]: canon } } : {}),
    ...(versions !== undefined ? { versions } : {}),
  }
}

/** A panel can show one section of a node's output; replace only that section. */
function revised(original: string, shown: string, edit: string): string {
  const at = shown === '' ? -1 : original.indexOf(shown)
  return at === -1 ? edit : original.slice(0, at) + edit + original.slice(at + shown.length)
}

/** Forks the source run with revised outputs, returning the streamed run of record. */
export async function runFork(engine: EngineClient, runId: string, request: ForkRequest, onEvent?: OnEvent): Promise<Answer> {
  if ((await engine.capabilities()).runFork !== true) return { kind: 'refused', said: UNSUPPORTED_FORK, unsupported: true }
  return answer(engine, {
    open: () => engine.forkRun(runId, request),
    calledOn: runId,
    onEvent,
    refusals: {
      endpoint: 'runFork',
      unsupported: UNSUPPORTED_FORK,
      running: said => `This run cannot be forked yet: ${said}`,
      gone: 'This run or a revised node no longer exists',
      invalid: said => `The engine would not rerun downstream: ${said}`,
    },
  })
}
