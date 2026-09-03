/**
 * Whether the engine is reachable, kept current by a poll. `unknown` is the
 * state before the first answer, so a pill can say "checking".
 */
export type EngineState = 'unknown' | 'online' | 'offline'

export type EngineStateListener = (state: EngineState) => void

/** Fast enough to feel live, slow enough that an idle vault is not chatty. */
const DEFAULT_INTERVAL_MS = 3000

export interface EngineStatusOptions {
  intervalMs?: number
}

/** Owns the poll loop; it takes a reachability check rather than a client. */
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

  /** Checks now rather than waiting out an interval, and returns what was found. */
  async refresh(): Promise<EngineState> {
    await this.poll()
    return this.current
  }

  /** The check a caller is waiting on: the one already running, or a new one. */
  private poll(): Promise<void> {
    // Joining an in-flight check keeps a slow engine from stacking polls.
    this.inFlight ??= this.runPoll().finally(() => {
      this.inFlight = undefined
      this.rearm()
    })
    return this.inFlight
  }

  /** Records first-hand evidence that the engine is gone: a request that never reached it. */
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
