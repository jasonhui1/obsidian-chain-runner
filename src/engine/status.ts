/**
 * Whether the engine is reachable, kept current by a gentle poll.
 *
 * `unknown` is the state before the first answer, so a pill can say "checking"
 * instead of claiming the engine is down while the first request is still in
 * flight.
 */
export type EngineState = 'unknown' | 'online' | 'offline'

export type EngineStateListener = (state: EngineState) => void

/** Fast enough to feel live, slow enough that an idle vault is not chatty. */
const DEFAULT_INTERVAL_MS = 3000

export interface EngineStatusOptions {
  intervalMs?: number
}

/**
 * Owns the poll loop and nothing else — it takes a reachability check rather
 * than a client, so the plugin's status pill can be driven by a fake in a test
 * and by a real socket at runtime.
 */
export class EngineStatus {
  readonly intervalMs: number
  private current: EngineState = 'unknown'
  private readonly listeners = new Set<EngineStateListener>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private inFlight: Promise<void> | undefined
  private running = false

  constructor(
    private readonly ping: () => Promise<boolean>,
    options: EngineStatusOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  }

  get state(): EngineState {
    return this.current
  }

  get isOnline(): boolean {
    return this.current === 'online'
  }

  /** Subscribes to changes; the returned function unsubscribes. */
  onChange(listener: EngineStateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Checks immediately, then keeps checking. Calling it twice is harmless. */
  start(): void {
    if (this.running) return
    this.running = true
    void this.poll()
  }

  stop(): void {
    this.running = false
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /**
   * Checks now and returns what was found — the call a settings change or an
   * action about to need the engine makes, rather than waiting out an interval.
   */
  async refresh(): Promise<EngineState> {
    await this.poll()
    return this.current
  }

  /** The check a caller is waiting on: the one already running, or a new one. */
  private poll(): Promise<void> {
    // Joining an in-flight check rather than starting a second one keeps a slow
    // engine from stacking polls, without ever handing back a stale answer.
    this.inFlight ??= this.runPoll().finally(() => {
      this.inFlight = undefined
      this.rearm()
    })
    return this.inFlight
  }

  /**
   * Records first-hand evidence that the engine is gone — a request that failed
   * to reach it. Cheaper and more current than waiting out the next interval.
   */
  markOffline(): void {
    this.set('offline')
  }

  private async runPoll(): Promise<void> {
    try {
      this.set((await this.ping()) ? 'online' : 'offline')
    } catch {
      // A check that cannot even be made is the same news as one that failed.
      this.set('offline')
    }
  }

  private rearm(): void {
    if (!this.running) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.poll(), this.intervalMs)
  }

  private set(next: EngineState): void {
    if (next === this.current) return
    this.current = next
    for (const listener of this.listeners) listener(next)
  }
}
