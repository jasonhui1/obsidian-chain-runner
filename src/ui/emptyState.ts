import type { EngineState } from '../engine/status'
import type { RunStatus } from '../run/session'

/**
 * What the result view says when it has no panels to draw. `tone` names the
 * condition and the stylesheet colours it, the way `panelCopy.ts` does for a
 * panel.
 */
export type EmptyTone = 'idle' | 'offline' | 'waiting' | 'failed'

export interface EmptyState {
  tone: EmptyTone
  /** One line saying what the situation is. */
  title: string
  /** One line saying what to do about it, or where the reason already is. */
  hint: string
}

/** Where the engine is and whether it answers, as the empty state reads it. */
export interface EngineReading {
  state: EngineState
  url: string
}

export interface EmptyStateInput {
  /** The run on screen, or `undefined` when none has been launched. */
  run: { status: RunStatus } | undefined
  engine: EngineReading
}

export function emptyStateFor({ run, engine }: EmptyStateInput): EmptyState {
  // A launched run says what happened to it, whatever the engine is doing now.
  if (run) return LAUNCHED[run.status]
  // Only `offline` is evidence; `unknown` is the state before the first check
  // answered (`engine/status.ts`).
  if (engine.state === 'offline') {
    return {
      tone: 'offline',
      title: 'No engine',
      hint: `Nothing is listening at ${engine.url}. Start maestro-playground, or set another engine URL in settings.`,
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
