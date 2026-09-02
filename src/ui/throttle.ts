/**
 * How often the result view redraws while a run streams.
 *
 * Tokens arrive faster than markdown can be parsed and laid out, and a redraw
 * per token makes a long output stutter. Ten frames a second is above the rate a
 * reader perceives as continuous and an order of magnitude below the token rate.
 */
export const RENDER_INTERVAL_MS = 100

export interface Throttle {
  /** Runs now if the interval has passed, otherwise holds this call for its end. */
  run(work: () => void): void
  /** Runs what is held, now. The last frame of a run goes through this. */
  flush(): void
  /** Drops what is held — the view is going away. */
  cancel(): void
}

/**
 * Leading and trailing, keeping only the newest held call: every call redraws
 * the whole view from the same state, so an intermediate frame has nothing in it
 * the next one lacks.
 */
export function createThrottle(intervalMs: number = RENDER_INTERVAL_MS): Throttle {
  let timer: ReturnType<typeof setTimeout> | undefined
  let held: (() => void) | undefined

  function fire(work: () => void): void {
    work()
    // The window opens on the run, not on the last call, so a steady stream
    // redraws on a fixed cadence rather than drifting slower.
    timer = setTimeout(() => {
      timer = undefined
      const pending = held
      held = undefined
      if (pending) fire(pending)
    }, intervalMs)
  }

  return {
    run(work) {
      if (timer === undefined) fire(work)
      else held = work
    },
    flush() {
      const pending = held
      held = undefined
      if (pending) pending()
    },
    cancel() {
      held = undefined
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
}
