export interface PruneTarget {
  /** Return the number removed, between zero and the requested bound. */
  prune(limit: number): Promise<number>
}

export type PruneWorkerOptions = {
  readonly limit?: number
  readonly intervalMs?: number
  /** Awaited operational-error observation; a failed observer is reported by close(). */
  readonly onError?: (error: unknown) => void | Promise<void>
}
export type PruneWorkerSnapshot = {
  readonly state: 'idle' | 'running' | 'closing' | 'closed'
  readonly active: boolean
  readonly runs: number
  readonly removed: number
  readonly errors: number
  readonly observerErrors: number
}

/** Explicitly owned native-host polling. Fetch hosts should use bounded prune() calls. */
export class PruneWorker {
  private readonly limit: number
  private readonly intervalMs: number
  private readonly onError: PruneWorkerOptions['onError']
  private state: PruneWorkerSnapshot['state'] = 'idle'
  private active = false
  private runs = 0
  private removed = 0
  private errors = 0
  private observerErrors = 0
  private observerFailure: { error: unknown } | undefined
  private loopPromise: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private wake: (() => void) | undefined
  constructor(private readonly target: PruneTarget, options: PruneWorkerOptions = {}) {
    this.limit = options.limit ?? 100
    this.intervalMs = options.intervalMs ?? 60_000
    this.onError = options.onError
    if (!target || typeof target.prune !== 'function') throw new Error('Prune worker requires a pruner')
    if (!Number.isSafeInteger(this.limit) || this.limit < 1 || this.limit > 10_000) throw new Error('Invalid cleanup limit')
    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs < 1 || this.intervalMs > 2_147_483_647) throw new Error('Invalid cleanup interval')
    if (this.onError !== undefined && typeof this.onError !== 'function') throw new Error('Invalid cleanup error observer')
  }
  snapshot(): PruneWorkerSnapshot {
    return { state: this.state, active: this.active, runs: this.runs, removed: this.removed, errors: this.errors, observerErrors: this.observerErrors }
  }
  start(): void {
    if (this.state !== 'idle') throw new Error('Cleanup can only start once')
    this.state = 'running'
    // Establish ownership before a custom pruner can synchronously call close().
    this.loopPromise = Promise.resolve().then(() => this.loop())
  }
  private wait(): Promise<void> {
    if (this.state !== 'running') return Promise.resolve()
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); this.wake = undefined; resolve() }
      const timer = setTimeout(done, this.intervalMs)
      this.wake = done
    })
  }
  private async loop(): Promise<void> {
    while (this.state === 'running') {
      this.active = true; this.runs++
      try {
        const removed = await this.target.prune(this.limit)
        if (!Number.isSafeInteger(removed) || removed < 0 || removed > this.limit) throw new Error('Invalid cleanup removal count')
        this.removed += removed
      } catch (error) {
        this.errors++
        try { await this.onError?.(error) }
        catch (error) { this.observerErrors++; this.observerFailure ??= { error } }
      } finally { this.active = false }
      // Even a full batch waits; backlog and outages never create a catch-up spin.
      await this.wait()
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.state = 'closing'; this.wake?.()
    this.closing = (async () => {
      try { await this.loopPromise } finally { this.state = 'closed' }
      if (this.observerFailure) throw this.observerFailure.error
    })()
    return this.closing
  }
}
