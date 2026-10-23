export type CheckContext = { readonly signal: AbortSignal }
export type ReadinessCheck = (context: CheckContext) => boolean | Promise<boolean>
export type CheckResult = { readonly name: string; readonly status: 'pass' | 'fail' | 'timeout' | 'busy' | 'cancelled'; readonly durationMs: number }
export type ReadinessReport = {
  readonly status: 'ready' | 'not-ready'
  readonly phase: 'starting' | 'serving' | 'draining' | 'closed'
  readonly checks: readonly CheckResult[]
}
export type ReadinessOptions = { readonly timeoutMs?: number; readonly maxChecks?: number }
type Flight = { readonly controller: AbortController; result: Promise<CheckResult>; done: Promise<void>; timedOut: boolean }
type Check = { readonly name: string; readonly run: ReadinessCheck; readonly timeoutMs: number; flight?: Flight }
function timeout(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) throw new Error('Invalid readiness timeoutMs')
  return value
}

/** Deadline-bounded responses; at most one underlying operation per named check. */
export class Readiness {
  private readonly checks = new Map<string, Check>()
  private readonly timeoutMs: number
  private readonly maxChecks: number
  private phase: ReadinessReport['phase'] = 'starting'
  private closing: Promise<void> | undefined
  constructor(options: ReadinessOptions = {}) {
    this.timeoutMs = timeout(options.timeoutMs ?? 500)
    this.maxChecks = options.maxChecks ?? 32
    if (!Number.isSafeInteger(this.maxChecks) || this.maxChecks < 1 || this.maxChecks > 128) throw new Error('Invalid maxChecks')
  }
  add(name: string, run: ReadinessCheck, options: { timeoutMs?: number } = {}): this {
    if (this.phase !== 'starting') throw new Error('Readiness checks must be configured before start')
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(name) || this.checks.has(name)) throw new Error('Invalid or duplicate readiness check name')
    if (typeof run !== 'function') throw new Error('Readiness check must be a function')
    if (this.checks.size >= this.maxChecks) throw new Error('Readiness check capacity exceeded')
    this.checks.set(name, { name, run, timeoutMs: timeout(options.timeoutMs ?? this.timeoutMs) })
    return this
  }
  start(): void {
    if (this.phase !== 'starting') throw new Error('Readiness can only start once')
    this.phase = 'serving'
  }
  snapshot() { return { phase: this.phase, active: [...this.checks.values()].filter((check) => check.flight).length } }
  async check(): Promise<ReadinessReport> {
    if (this.phase !== 'serving') return { status: 'not-ready', phase: this.phase, checks: [] }
    const checks = await Promise.all([...this.checks.values()].map((check) => this.run(check)))
    return { status: this.phase === 'serving' && checks.every((check) => check.status === 'pass') ? 'ready' : 'not-ready', phase: this.phase, checks }
  }
  private run(check: Check): Promise<CheckResult> {
    if (check.flight) return check.flight.timedOut
      ? Promise.resolve({ name: check.name, status: 'busy', durationMs: 0 }) : check.flight.result
    const started = performance.now(), controller = new AbortController()
    let settle!: (status: CheckResult['status']) => void
    const flight: Flight = { controller, timedOut: false, done: Promise.resolve(), result: Promise.resolve(null as never) }
    const duration = () => Math.max(0, performance.now() - started)
    flight.result = new Promise((resolve) => {
      let resolved = false
      settle = (status) => {
        if (resolved) return
        resolved = true; clearTimeout(timer)
        controller.signal.removeEventListener('abort', cancelled)
        resolve({ name: check.name, status, durationMs: duration() })
      }
      const cancelled = () => settle('cancelled')
      controller.signal.addEventListener('abort', cancelled, { once: true })
      const timer = setTimeout(() => { flight.timedOut = true; settle('timeout'); controller.abort(new Error('Readiness deadline exceeded')) }, check.timeoutMs)
    })
    check.flight = flight
    const operation = Promise.resolve().then(() => check.run({ signal: controller.signal }))
    flight.done = operation.then((value) => { settle(value === true ? 'pass' : 'fail') }, () => { settle('fail') }).then(() => {
      if (check.flight === flight) delete check.flight
    })
    return flight.result
  }
  beginDrain(): void {
    if (this.phase === 'closed') return
    this.phase = 'draining'
    for (const check of this.checks.values()) check.flight?.controller.abort(new Error('Readiness draining'))
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.beginDrain()
    this.closing = Promise.all([...this.checks.values()].map((check) => check.flight?.done)).then(() => { this.phase = 'closed' })
    return this.closing
  }
}
