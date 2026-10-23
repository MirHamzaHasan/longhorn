import type { SpanExporter, SpanRecord } from './tracing.js'
const copy = (span: SpanRecord): SpanRecord => ({ ...span, context: { ...span.context }, attributes: { ...span.attributes } })
/** Bounded local diagnostic buffer. Export/snapshots do not retain caller-owned objects. */
export class MemorySpanExporter implements SpanExporter {
  private readonly capacity: number
  private readonly records: SpanRecord[] = []
  private closed = false
  private overwritten = 0
  constructor(options: { capacity?: number } = {}) {
    this.capacity = options.capacity ?? 128
    if (!Number.isSafeInteger(this.capacity) || this.capacity < 1 || this.capacity > 10_000) throw new Error('Invalid span capacity')
  }
  async export(spans: readonly SpanRecord[]): Promise<void> {
    if (this.closed) throw new Error('Span exporter is closed')
    for (const span of spans) {
      if (this.records.length >= this.capacity) { this.records.shift(); this.overwritten++ }
      this.records.push(copy(span))
    }
  }
  snapshot(): readonly SpanRecord[] { return this.records.map(copy) }
  stats() { return { closed: this.closed, size: this.records.length, overwritten: this.overwritten } }
  async close(): Promise<void> { this.closed = true }
}
