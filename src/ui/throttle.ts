/**
 * How often the result view redraws while a run streams. Ten frames a second
 * reads as continuous and is well below the rate tokens arrive at.
 */
export const RENDER_INTERVAL_MS = 100

export interface Throttle {
  /** Runs now if the interval has passed, otherwise holds this call for its end. */
  run(work: () => void): void
  /** Drops what is held: the view is going away, or is about to draw something newer. */
  cancel(): void
}

/**
 * Leading and trailing, keeping only the newest held call — every call redraws
 * the whole view, so an intermediate frame has nothing the next one lacks.
 */
export function createThrottle(intervalMs: number = RENDER_INTERVAL_MS): Throttle {
  let timer: ReturnType<typeof setTimeout> | undefined
  let held: (() => void) | undefined

  function fire(work: () => void): void {
    work()
    // The window opens on the run, so a steady stream keeps a fixed cadence.
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
    cancel() {
      held = undefined
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
}
