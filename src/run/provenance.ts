/**
 * Where an output note came from. The note stores the engine's run id, never a
 * URL of its own — the engine's address is a setting, and a run outlives a
 * reader changing it — so the link back is resolved when it is shown (ADR-0004).
 */

export const SOURCE_RUN = 'source run'
export const SOURCE_RUN_DELETED = 'source run deleted'

/** The engine's result view for a run. Its API lives under `/api/runs/:id`. */
const RUN_VIEW = 'runs'

/** Whether the engine still holds a run. `unknown` is an engine that could not be asked. */
export type RunExistence = 'found' | 'missing' | 'unknown'

/** The run an output note names, as the header shows it. */
export type SourceRun =
  /** `url` is absent when the engine URL will not parse; the run is still named. */
  | { kind: 'run'; runId: string; url?: string }
  | { kind: 'deleted'; runId: string }

export function sourceRunLabel(source: SourceRun): string {
  return source.kind === 'deleted' ? SOURCE_RUN_DELETED : SOURCE_RUN
}

/**
 * The run a note was written by, or `undefined` when it is not an output note.
 * Both keys are required: `run` alone is a word another plugin may well use.
 */
export function sourceRunId(frontmatter: unknown): string | undefined {
  if (typeof frontmatter !== 'object' || frontmatter === null) return undefined
  const { run, output } = frontmatter as Record<string, unknown>
  if (typeof run !== 'string' || run === '' || typeof output !== 'string') return undefined
  return run
}

export function runViewUrl(engineUrl: string, runId: string): string | undefined {
  try {
    const base = engineUrl.endsWith('/') ? engineUrl : `${engineUrl}/`
    return new URL(`${RUN_VIEW}/${encodeURIComponent(runId)}`, base).toString()
  } catch {
    return undefined
  }
}

/**
 * What to show for a note's run. Only an engine that answers *and* says it has
 * no such run makes a reference dangling; one that cannot be reached is a link
 * still, because the run is not gone, the engine is.
 */
export async function resolveSourceRun(input: {
  runId: string
  engineUrl: string
  exists: (runId: string) => Promise<RunExistence>
}): Promise<SourceRun> {
  const { runId, engineUrl } = input
  const existence = await ask(input.exists, runId)
  if (existence === 'missing') return { kind: 'deleted', runId }
  const url = runViewUrl(engineUrl, runId)
  return { kind: 'run', runId, ...(url ? { url } : {}) }
}

/** A resolver that throws has not answered, which is not the same as answering no. */
async function ask(exists: (runId: string) => Promise<RunExistence>, runId: string): Promise<RunExistence> {
  try {
    return await exists(runId)
  } catch {
    return 'unknown'
  }
}
