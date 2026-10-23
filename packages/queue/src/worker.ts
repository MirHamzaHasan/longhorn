import type { Queue } from './queue.js'
import type { JobHandler } from './types.js'

export type WorkerOptions = {
  readonly concurrency?: number
  readonly pollIntervalMs?: number
  /** Operational errors, such as a failed claim. Handler failures become job retry/failure states. */
  readonly onError?: (error: unknown) => void
}

/** Host-owned polling. Fetch platforms should schedule bounded runOnce calls instead. */
export class QueueWorker<T> {
  private readonly concurrency: number
  private readonly pollIntervalMs: number
  private readonly onError: ((error: unknown) => void) | undefined
  private state: 'idle' | 'running' | 'closing' | 'closed' = 'idle'
  private loops: Promise<void>[] = []
  private readonly wakeups = new Set<() => void>()
  private closing: Promise<void> | undefined
  private observerFailure: { error: unknown } | undefined
  private active = 0
  private errors = 0
  constructor(private readonly queue: Queue<T>, private readonly handler: JobHandler<T>, options: WorkerOptions = {}) {
    this.concurrency = options.concurrency ?? 1
    this.pollIntervalMs = options.pollIntervalMs ?? 250
    this.onError = options.onError
    if (!Number.isSafeInteger(this.concurrency) || this.concurrency < 1 || this.concurrency > 64) throw new Error('Invalid worker concurrency')
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 1 || this.pollIntervalMs > 2_147_483_647) throw new Error('Invalid pollIntervalMs')
  }
  snapshot() { return { state: this.state, active: this.active, errors: this.errors } }
  start(): void {
    if (this.state !== 'idle') throw new Error('Worker can only start once')
    this.state = 'running'
    this.loops = Array.from({ length: this.concurrency }, () => this.loop())
  }
  private wait(delay = this.pollIntervalMs): Promise<void> {
    if (this.state !== 'running') return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); this.wakeups.delete(done); resolve() }
      const timer = setTimeout(done, delay)
      this.wakeups.add(done)
    })
  }
  private async loop(): Promise<void> {
    let sinceYield = 0
    while (this.state === 'running') {
      let pause = false
      this.active++
      try { pause = (await this.queue.runOnce(this.handler)).status === 'idle' }
      catch (error) {
        pause = true; this.errors++
        try { this.onError?.(error) } catch (error) { this.observerFailure ??= { error } }
      } finally { this.active-- }
      if (pause) { sinceYield = 0; await this.wait() }
      else if (++sinceYield >= 32) { sinceYield = 0; await this.wait(0) }
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.state = 'closing'
    for (const wake of this.wakeups) wake()
    this.closing = Promise.all(this.loops).then(() => {
      this.state = 'closed'
      if (this.observerFailure) throw this.observerFailure.error
    })
    return this.closing
  }
}
