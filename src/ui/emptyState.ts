import type { EngineState } from '../engine/status'
import type { RunStatus } from '../run/session'

/**
 * What the result view says when it has no panels to draw. Five situations, and
 * a designed state for each: `tone` names the condition and the stylesheet
 * colours it, the way `panelCopy.ts` does for a panel.
 */
export type EmptyTone = 'idle' | 'offline' | 'waiting' | 'failed'

export interface EmptyState {
  tone: EmptyTone
  /** One line saying what the situation is. */
  title: string
  /** One line saying what to do about it, or where the reason already is. */
  hint: string
}

export interface EmptyStateInput {
  /** The run on screen, or `undefined` when none has been launched. */
  run: { status: RunStatus } | undefined
  engine: EngineState
  engineUrl: string
}

export function emptyStateFor({ run, engine, engineUrl }: EmptyStateInput): EmptyState {
  // A launched run says what happened to it. The engine may have gone since,
  // but what is on screen is this run's news, not the engine's.
  if (run) return LAUNCHED[run.status]
  // `unknown` is the state before the first check answered, and claiming the
  // engine is gone on no evidence is worse than inviting a run that then fails.
  if (engine === 'offline') {
    return {
      tone: 'offline',
      title: 'No engine',
      hint: `Nothing is listening at ${engineUrl}. Start maestro-playground, or set another engine URL in settings.`,
    }
  }
  return {
    tone: 'idle',
    title: 'No run yet',
    hint: 'Open a note and run Chain Runner: Run chain on this note — the result reads here.',
  }
}

const LAUNCHED: Record<RunStatus, EmptyState> = {
  running: {
    tone: 'waiting',
    title: 'Waiting for the first hop',
    hint: 'The engine has the run. Panels appear as it projects them.',
  },
  failed: {
    tone: 'failed',
    title: 'The run landed nothing',
    hint: 'It failed before a hop wrote anything. The reason is above.',
  },
  done: {
    tone: 'idle',
    title: 'The run landed nothing',
    hint: 'It finished without a panel to show — the chain declared no output that survived.',
  },
}
