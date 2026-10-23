import type { Scheduler } from './scheduler.js'

export type RunnerOptions = { readonly pollIntervalMs?: number; readonly batchSize?: number; readonly onError?: (error: unknown) => void }
/** Explicit host timer. Each tick is bounded and serialized; no per-schedule timers. */
export class SchedulerRunner {
  private readonly pollIntervalMs: number
  private readonly batchSize: number
  private readonly onError: ((error: unknown) => void) | undefined
  private state: 'idle' | 'running' | 'closing' | 'closed' = 'idle'
  private loop: Promise<void> = Promise.resolve()
  private wake: (() => void) | undefined
  private closing: Promise<void> | undefined
  private observerFailure: { error: unknown } | undefined
  private active = false
  private errors = 0
  private dispatched = 0
  constructor(private readonly scheduler: Scheduler, options: RunnerOptions = {}) {
    this.pollIntervalMs = options.pollIntervalMs ?? 250; this.batchSize = options.batchSize ?? 100; this.onError = options.onError
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 1 || this.pollIntervalMs > 2_147_483_647) throw new Error('Invalid pollIntervalMs')
    if (!Number.isSafeInteger(this.batchSize) || this.batchSize < 1 || this.batchSize > 1000) throw new Error('Invalid batchSize')
  }
  snapshot() { return { state: this.state, active: this.active, errors: this.errors, dispatched: this.dispatched } }
  start(): void {
    if (this.state !== 'idle') throw new Error('Scheduler runner can only start once')
    this.state = 'running'; this.loop = this.run()
  }
  private wait(delay: number): Promise<void> {
    if (this.state !== 'running') return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); this.wake = undefined; resolve() }
      const timer = setTimeout(done, delay); this.wake = done
    })
  }
  private async run(): Promise<void> {
    while (this.state === 'running') {
      let more = false
      this.active = true
      try {
        const result = await this.scheduler.tick({ limit: this.batchSize })
        more = result.more; this.dispatched += result.dispatched.length
      } catch (error) {
        this.errors++
        try { this.onError?.(error) } catch (error) { this.observerFailure ??= { error } }
      } finally { this.active = false }
      await this.wait(more ? 0 : this.pollIntervalMs)
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.state = 'closing'; this.wake?.()
    this.closing = this.loop.then(() => {
      this.state = 'closed'
      if (this.observerFailure) throw this.observerFailure.error
    })
    return this.closing
  }
}
