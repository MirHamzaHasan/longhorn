export type SpanContext = { readonly traceId: string; readonly spanId: string; readonly sampled: boolean }
export type Attributes = Readonly<Record<string, string | number | boolean>>
export type SpanOptions = { readonly parent?: SpanContext; readonly kind?: 'internal' | 'server' | 'producer' | 'consumer'; readonly attributes?: Attributes }
export type SpanRecord = {
  readonly name: string; readonly kind: NonNullable<SpanOptions['kind']>; readonly context: SpanContext
  readonly parentSpanId: string | null; readonly startedAt: number; readonly endedAt: number; readonly durationMs: number
  readonly status: 'unset' | 'ok' | 'error'; readonly attributes: Attributes
}
export interface Span {
  readonly context: SpanContext
  readonly recording: boolean
  setName(name: string): void
  setAttribute(name: string, value: string | number | boolean): void
  setStatus(status: SpanRecord['status']): void
  end(): void
}
export interface TraceProvider { startSpan(name: string, options?: SpanOptions): Span }
export interface SpanExporter { export(spans: readonly SpanRecord[]): Promise<void>; close(): Promise<void> }
export type TraceStats = { readonly active: number; readonly queued: number; readonly exported: number; readonly dropped: number; readonly exportErrors: number; readonly instrumentationErrors: number; readonly closed: boolean }
export type TracerOptions = {
  readonly exporter: SpanExporter; readonly sampleRate?: number
  readonly maxActiveSpans?: number; readonly maxQueuedSpans?: number; readonly batchSize?: number
  readonly onError?: (error: unknown) => void; readonly now?: () => number; readonly monotonicNow?: () => number
}
export class TracerClosedError extends Error { constructor() { super('Tracer is closing or closed'); this.name = 'TracerClosedError' } }
export class TraceExporterError extends Error {
  constructor(readonly operation: 'export' | 'close', cause: unknown) { super(`Trace exporter ${operation} failed`, { cause }); this.name = 'TraceExporterError' }
}
const traceIdPattern = /^[0-9a-f]{32}$/
const spanIdPattern = /^[0-9a-f]{16}$/
function validContext(value: SpanContext): boolean {
  return typeof value === 'object' && value !== null && typeof value.traceId === 'string' && typeof value.spanId === 'string' &&
    traceIdPattern.test(value.traceId) && !/^0+$/.test(value.traceId) && spanIdPattern.test(value.spanId) && !/^0+$/.test(value.spanId) && typeof value.sampled === 'boolean'
}
export function parseTraceparent(value: string | null | undefined): SpanContext | undefined {
  if (typeof value !== 'string' || value.length < 55 || value.length > 512) return undefined
  const match = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})([^\s,]*)$/.exec(value)
  if (!match || match[1] === 'ff' || (match[1] === '00' && match[5] !== '') || (match[5] !== '' && !match[5]!.startsWith('-'))) return undefined
  const context = { traceId: match[2]!, spanId: match[3]!, sampled: (parseInt(match[4]!, 16) & 1) === 1 }
  return validContext(context) ? context : undefined
}
export function formatTraceparent(context: SpanContext): string {
  if (!validContext(context)) throw new Error('Invalid span context')
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? '01' : '00'}`
}
function positive(value: number, name: string) { if (!Number.isSafeInteger(value) || value < 1 || value > 100_000) throw new Error(`Invalid ${name}`); return value }
function name(value: string) { if (typeof value !== 'string' || !value || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Invalid span name') }
function attribute(key: string, value: unknown) {
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key) || !['string', 'number', 'boolean'].includes(typeof value) ||
    (typeof value === 'string' && value.length > 256) || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Invalid span attribute')
}
function readClock(clock: () => number): number { const value = clock(); if (!Number.isFinite(value) || value < 0) throw new Error('Invalid trace clock'); return value }
function randomId(bytes: number) {
  const values = crypto.getRandomValues(new Uint8Array(bytes))
  // A generated ID must be nonzero even if an injected/random source returns all zeroes.
  if (values.every((value) => value === 0)) values[values.length - 1] = 1
  return [...values].map((value) => value.toString(16).padStart(2, '0')).join('')
}

/** Explicit context passing; bounded best-effort export with one exporter call at a time. */
export class Tracer implements TraceProvider {
  private readonly exporter: SpanExporter
  private readonly sampleRate: number
  private readonly maxActive: number
  private readonly maxQueued: number
  private readonly batchSize: number
  private readonly onError: ((error: unknown) => void) | undefined
  private readonly clock: () => number
  private readonly monotonic: () => number
  private readonly active = new Set<Promise<void>>()
  private readonly queue: SpanRecord[] = []
  private pumping: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private closed = false
  private exported = 0
  private dropped = 0
  private exportErrors = 0
  private instrumentationErrors = 0
  constructor(options: TracerOptions) {
    this.exporter = options.exporter; this.sampleRate = options.sampleRate ?? 1
    if (!Number.isFinite(this.sampleRate) || this.sampleRate < 0 || this.sampleRate > 1) throw new Error('Invalid sampleRate')
    this.maxActive = positive(options.maxActiveSpans ?? 128, 'maxActiveSpans')
    this.maxQueued = positive(options.maxQueuedSpans ?? 256, 'maxQueuedSpans')
    this.batchSize = positive(options.batchSize ?? 64, 'batchSize')
    this.onError = options.onError; this.clock = options.now ?? Date.now; this.monotonic = options.monotonicNow ?? (() => performance.now())
  }
  private report(error: unknown) { try { this.onError?.(error) } catch { this.instrumentationErrors++ } }
  startSpan(initialName: string, options: SpanOptions = {}): Span {
    if (this.closing) throw new TracerClosedError()
    name(initialName)
    const parent = options.parent ? { ...options.parent } : undefined
    if (parent && !validContext(parent)) throw new Error('Invalid parent context')
    const kind = options.kind ?? 'internal'
    if (!['internal', 'server', 'producer', 'consumer'].includes(kind)) throw new Error('Invalid span kind')
    const attributes: Record<string, string | number | boolean> = {}
    for (const [key, value] of Object.entries(options.attributes ?? {})) { attribute(key, value); attributes[key] = value }
    if (Object.keys(attributes).length > 32) throw new Error('Span attribute capacity exceeded')
    const traceId = parent?.traceId ?? randomId(16)
    const sampled = parent?.sampled ?? (parseInt(traceId.slice(0, 8), 16) / 0x1_0000_0000 < this.sampleRate)
    const context = Object.freeze({ traceId, spanId: randomId(8), sampled })
    const recording = sampled && this.active.size < this.maxActive
    if (sampled && !recording) this.dropped++
    const startedAt = readClock(this.clock), startedMono = readClock(this.monotonic)
    let spanName = initialName, status: SpanRecord['status'] = 'unset', ended = false
    let finish = () => {}
    if (recording) {
      let done!: () => void
      const pending = new Promise<void>((resolve) => { done = resolve })
      this.active.add(pending)
      finish = () => { this.active.delete(pending); done() }
    }
    return {
      context, recording,
      setName: (value) => { if (ended) return; name(value); spanName = value },
      setAttribute: (key, value) => {
        if (ended || !recording) return
        attribute(key, value)
        if (!Object.hasOwn(attributes, key) && Object.keys(attributes).length >= 32) throw new Error('Span attribute capacity exceeded')
        attributes[key] = value
      },
      setStatus: (value) => { if (ended) return; if (!['unset', 'ok', 'error'].includes(value)) throw new Error('Invalid span status'); status = value },
      end: () => {
        if (ended) return
        ended = true
        try {
          if (!recording) return
          const endedAt = Math.max(startedAt, readClock(this.clock)), durationMs = Math.max(0, readClock(this.monotonic) - startedMono)
          if (this.queue.length >= this.maxQueued) { this.dropped++; return }
          this.queue.push(Object.freeze({ name: spanName, kind, context, parentSpanId: parent?.spanId ?? null,
            startedAt, endedAt, durationMs, status, attributes: Object.freeze({ ...attributes }) }))
          this.schedule()
        } catch (error) { this.dropped++; throw error } finally { finish() }
      },
    }
  }
  /** Telemetry failures do not replace the original business result/error. */
  async trace<T>(spanName: string, work: (span: Span | undefined) => T | Promise<T>, options: SpanOptions = {}): Promise<T> {
    let span: Span | undefined
    try { span = this.startSpan(spanName, options) } catch (error) { this.instrumentationErrors++; this.report(error) }
    try {
      const result = await work(span)
      span?.setStatus('ok'); return result
    } catch (error) { span?.setStatus('error'); throw error }
    finally { try { span?.end() } catch (error) { this.instrumentationErrors++; this.report(error) } }
  }
  private schedule(): void {
    if (this.pumping) return
    this.pumping = Promise.resolve().then(async () => {
      while (this.queue.length) {
        const batch = this.queue.splice(0, this.batchSize)
        try { await this.exporter.export(batch); this.exported += batch.length }
        catch (cause) { this.exportErrors++; this.dropped += batch.length; this.report(new TraceExporterError('export', cause)) }
      }
    }).finally(() => { this.pumping = undefined; if (this.queue.length) this.schedule() })
  }
  snapshot(): TraceStats { return { active: this.active.size, queued: this.queue.length, exported: this.exported, dropped: this.dropped, exportErrors: this.exportErrors, instrumentationErrors: this.instrumentationErrors, closed: this.closed } }
  async flush(): Promise<TraceStats> { while (this.pumping) await this.pumping; return this.snapshot() }
  close(): Promise<void> {
    this.closing ??= (async () => {
      await Promise.all([...this.active]); await this.flush()
      try { await this.exporter.close() } catch (cause) { throw new TraceExporterError('close', cause) }
      finally { this.closed = true }
    })()
    return this.closing
  }
}
