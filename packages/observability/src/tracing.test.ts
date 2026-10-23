import { expect, it } from 'vitest'
import { formatTraceparent, parseTraceparent, Tracer, TracerClosedError } from './tracing.js'
import type { SpanExporter } from './tracing.js'
import { MemorySpanExporter } from './memory.js'
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done }); return { promise, resolve } }
const traceId = '4bf92f3577b34da6a3ce929d0e0e4736', spanId = '00f067aa0ba902b7'
it('parses traceparent common prefixes, rejects invalid IDs/duplicates/versions and emits only the sampling bit', () => {
  const parent = parseTraceparent(`00-${traceId}-${spanId}-09`)!
  expect(parent).toEqual({ traceId, spanId, sampled: true })
  expect(formatTraceparent(parent)).toBe(`00-${traceId}-${spanId}-01`)
  expect(() => formatTraceparent({ traceId, spanId: 1234567890123456 as never, sampled: true })).toThrow('Invalid span context')
  expect(parseTraceparent(`01-${traceId}-${spanId}-00-extension`)?.sampled).toBe(false)
  for (const input of [`ff-${traceId}-${spanId}-01`, `00-${'0'.repeat(32)}-${spanId}-01`, `00-${traceId}-${'0'.repeat(16)}-01`,
    `00-${traceId.toUpperCase()}-${spanId}-01`, `00-${traceId}-${spanId}-01-extra`, `00-${traceId}-${spanId}-01,00-${traceId}-${spanId}-01`]) expect(parseTraceparent(input)).toBeUndefined()
})
it('links explicit children, isolates metadata and samples consistently with the parent', async () => {
  let now = 100, mono = 10
  const exporter = new MemorySpanExporter(), tracer = new Tracer({ exporter, now: () => now, monotonicNow: () => mono, sampleRate: 0 })
  const parent = { traceId, spanId, sampled: true }
  const span = tracer.startSpan('operation', { parent, attributes: { role: 'server' } })
  parent.spanId = '1111111111111111'
  const child = tracer.startSpan('child', { parent: span.context })
  now = 120; mono = 25; child.end(); span.setStatus('ok'); span.end(); span.end()
  await tracer.flush()
  const records = exporter.snapshot()
  expect(records).toHaveLength(2)
  expect(records[0]!.context.traceId).toBe(traceId)
  expect(records[0]!.parentSpanId).toBe(span.context.spanId)
  expect(records[1]).toMatchObject({ parentSpanId: spanId, durationMs: 15, status: 'ok' })
  const unsampled = tracer.startSpan('not-recorded', { parent: { traceId, spanId, sampled: false } }); unsampled.end()
  const root = tracer.startSpan('root'); root.end()
  await tracer.close(); expect(exporter.snapshot()).toHaveLength(2)
})
it('bounds active spans and queued export while serializing exporter work', async () => {
  const entered = deferred(), release = deferred()
  let calls = 0, active = 0, peak = 0
  const exporter: SpanExporter = { export: async (batch) => {
    calls++; active++; peak = Math.max(peak, active)
    if (calls === 1) { entered.resolve(); await release.promise }
    active--
  }, close: async () => {} }
  const tracer = new Tracer({ exporter, maxActiveSpans: 1, maxQueuedSpans: 1, batchSize: 1 })
  const one = tracer.startSpan('one'), dropped = tracer.startSpan('active-overflow')
  expect(dropped.recording).toBe(false); dropped.end(); one.end(); await entered.promise
  tracer.startSpan('two').end(); tracer.startSpan('queue-overflow').end()
  expect(tracer.snapshot()).toMatchObject({ dropped: 2, queued: 1 })
  release.resolve(); await tracer.close(); expect(peak).toBe(1); expect(calls).toBe(2)
})
it('isolates failed exporters/observers from work and preserves thrown business errors', async () => {
  const exporter: SpanExporter = { export: async () => { throw new Error('export private cause') }, close: async () => {} }
  const tracer = new Tracer({ exporter, onError: () => { throw new Error('observer') } })
  expect(await tracer.trace('success', () => 3)).toBe(3)
  const failure = new Error('business')
  await expect(tracer.trace('failure', () => { throw failure })).rejects.toBe(failure)
  await tracer.close(); expect(tracer.snapshot()).toMatchObject({ exportErrors: 2, dropped: 2 })
  expect(await tracer.trace('after-close', () => 4)).toBe(4)
})
it('drains active spans before exports and exporter close, retaining a terminal cleanup error', async () => {
  const order: string[] = [], exporter: SpanExporter = { export: async () => { order.push('export') }, close: async () => { order.push('close'); throw new Error('close failed') } }
  const tracer = new Tracer({ exporter }), span = tracer.startSpan('accepted')
  const closing = tracer.close(); expect(tracer.close()).toBe(closing)
  expect(() => tracer.startSpan('late')).toThrow(TracerClosedError)
  await Promise.resolve(); expect(order).toEqual([])
  span.end(); await expect(closing).rejects.toMatchObject({ name: 'TraceExporterError', operation: 'close' })
  expect(order).toEqual(['export', 'close']); expect(tracer.snapshot().closed).toBe(true)
})
it('validates span bounds, releases failed end clocks and bounds/copies memory exports', async () => {
  const exporter = new MemorySpanExporter({ capacity: 1 })
  let now = 1
  const tracer = new Tracer({ exporter, now: () => now })
  expect(() => tracer.startSpan('bad\nname')).toThrow('name')
  const span = tracer.startSpan('clock'); now = Number.NaN
  expect(() => span.end()).toThrow('clock'); expect(tracer.snapshot().active).toBe(0)
  now = 2; tracer.startSpan('one').end(); tracer.startSpan('two').end(); await tracer.flush()
  expect(exporter.stats()).toMatchObject({ size: 1, overwritten: 1 })
  const snapshot = exporter.snapshot(); (snapshot[0]!.context as { traceId: string }).traceId = 'changed'
  expect(exporter.snapshot()[0]!.context.traceId).not.toBe('changed')
  await tracer.close()
})
