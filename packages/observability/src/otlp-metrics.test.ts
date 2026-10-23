import { expect,it,vi } from 'vitest'
import { MetricRegistry } from './metrics.js'
import type { MetricCollection } from './metrics.js'
import { OtlpHttpMetricExporter,OtlpMetricExportError } from './otlp-metrics.js'
import type { OtlpHttpMetricExporterOptions } from './otlp-metrics.js'
const ok=(value: unknown={}) => new Response(JSON.stringify(value),{ headers: { 'Content-Type': 'application/json' } })
const options=(fetch: typeof globalThis.fetch,extra: Partial<OtlpHttpMetricExporterOptions>={}) => ({ endpoint: 'http://127.0.0.1:4318/v1/metrics',serviceName: 'metrics-test',fetch,initialRetryDelayMs: 1,maxRetryDelayMs: 4,...extra })
function fixture() {
  let now=1792760000000
  const meter=new MetricRegistry({ now: () => now })
  const counter=meter.counter({ name: 'requests_total',help: 'Requests.',labelNames: ['route'] })
  counter.add(2,{ route: '/items/:id' });counter.add(1,{ route: '/items/:id' })
  meter.gauge({ name: 'active',help: 'Active.' }).set(-0.5)
  const histogram=meter.histogram({ name: 'latency_seconds',help: 'Latency.',buckets: [0,1,2] })
  for (const value of [0,0.5,2,3]) histogram.record(value)
  now++
  return { meter,counter,collection: meter.collect() }
}
it('exports cumulative counters, signed gauges and disjoint histogram buckets with exact uint64 strings',async () => {
  const calls: RequestInit[]=[],headers={ authorization: 'Bearer private-header' },resource={ 'service.instance.id': 'test-instance' }
  const exporter=new OtlpHttpMetricExporter(options(async (_url,init) => { calls.push(init!);return ok() },{ headers,resourceAttributes: resource }))
  const { collection }=fixture(),pending=exporter.export(collection)
  headers.authorization='changed';resource['service.instance.id']='changed'
  ;(collection.metrics[0]!.series[0] as { value: number }).value=999
  await pending
  const request=calls[0]!,envelope=JSON.parse(String(request.body)).resourceMetrics[0],scope=envelope.scopeMetrics[0]
  expect(scope.scope).toEqual({ name: '@longhorn/observability',version: '0.0.1' })
  expect(envelope.resource.attributes).toContainEqual({ key: 'service.instance.id',value: { stringValue: 'test-instance' } })
  expect(scope.metrics[0].sum).toMatchObject({ aggregationTemporality: 2,isMonotonic: true,dataPoints: [{ asDouble: 3,startTimeUnixNano: '1792760000000000000',timeUnixNano: '1792760000001000000',attributes: [{ key: 'route',value: { stringValue: '/items/:id' } }] }] })
  expect(scope.metrics[1].gauge.dataPoints).toEqual([{ asDouble: -0.5,timeUnixNano: '1792760000001000000',attributes: [] }])
  expect(scope.metrics[2].histogram).toMatchObject({ aggregationTemporality: 2,dataPoints: [{ count: '4',sum: 5.5,explicitBounds: [0,1,2],bucketCounts: ['1','1','1','1'] }] })
  expect(new Headers(request.headers).get('authorization')).toBe('Bearer private-header')
  expect(request).toMatchObject({ redirect: 'manual',credentials: 'omit',cache: 'no-store' })
  expect(exporter.stats()).toMatchObject({ acceptedDataPoints: 3,rejectedDataPoints: 0 });await exporter.close()
})
it('does not send empty families and validates bounds, identities, timestamps and histogram invariants before I/O',async () => {
  const send=vi.fn(async () => ok()),exporter=new OtlpHttpMetricExporter(options(send))
  const empty=new MetricRegistry();empty.counter({ name: 'unused',help: 'Unused.' });await exporter.export(empty.collect());expect(send).not.toHaveBeenCalled()
  const original=fixture().collection
  const invalid: MetricCollection[]=[{ ...original,collectedAt: original.startedAt-1 },{ ...original,collectedAt: 19000000000000 },
    { ...original,metrics: [original.metrics[0]!,original.metrics[0]!] },{ ...original,metrics: [{ ...original.metrics[0]!,name: 'bad-name' }] },
    { ...original,metrics: [{ ...original.metrics[0]!,series: [{ ...original.metrics[0]!.series[0]!,value: -1 }] }] },
    { ...original,metrics: [{ ...original.metrics[2]!,series: [{ ...original.metrics[2]!.series[0]!,buckets: [2,1,3] }] }] },
    { ...original,metrics: [{ ...original.metrics[2]!,series: [{ ...original.metrics[2]!.series[0]!,count: 0,sum: 1,buckets: [0,0,0] }] }] }]
  for (const collection of invalid) await expect(exporter.export(collection)).rejects.toMatchObject({ code: 'invalid-input' })
  const small=new OtlpHttpMetricExporter(options(send,{ maxRequestBytes: 256,maxDataPointsPerBatch: 2 }))
  await expect(small.export(original)).rejects.toMatchObject({ code: 'request-too-large' })
  const one={ ...original,metrics: [original.metrics[0]!] }
  await expect(small.export(one)).rejects.toMatchObject({ code: 'request-too-large' })
  expect(send).not.toHaveBeenCalled();await exporter.close();await small.close()
})
it('keeps cumulative start identity across collections, clamps backward clocks and leaves snapshots detached',() => {
  let now=1000
  const meter=new MetricRegistry({ now: () => now }),counter=meter.counter({ name: 'count',help: 'Count.' })
  counter.add(1);const first=meter.collect();now=1010;counter.add(2);const second=meter.collect();now=1005;meter.close()
  expect(first).toMatchObject({ startedAt: 1000,collectedAt: 1000 });expect(second).toMatchObject({ startedAt: 1000,collectedAt: 1010 })
  expect(meter.collect().collectedAt).toBe(1010);expect(first.metrics[0]!.series[0]!.value).toBe(1)
  ;(first.metrics[0]!.series[0] as { value: number }).value=99
  expect(meter.collect().metrics[0]!.series[0]!.value).toBe(3)
  now=Number.NaN;expect(() => meter.collect()).toThrow('clock')
})
it('uses metric partial acknowledgements without replay or leaking collector diagnostics',async () => {
  const send=vi.fn(async () => ok({ partialSuccess: { rejectedDataPoints: '1',errorMessage: 'private-rejection' } }))
  const exporter=new OtlpHttpMetricExporter(options(send)),error=await exporter.export(fixture().collection).catch(error => error)
  expect(error).toBeInstanceOf(OtlpMetricExportError);expect(error).toMatchObject({ code: 'partial',rejectedDataPoints: 1 })
  expect(send).toHaveBeenCalledTimes(1);expect(exporter.stats()).toMatchObject({ acceptedDataPoints: 2,rejectedDataPoints: 1,partialResponses: 1,warnings: 1 })
  expect(JSON.stringify(error)+String(error)+JSON.stringify(exporter.stats())).not.toContain('private-rejection');await exporter.close()
})
it('counts actual UTF-8 bytes and rejects sparse or malformed-Unicode metric input before network admission',async () => {
  const source=new MetricRegistry(),counter=source.counter({ name: 'unicode_total',help: 'Unicode.',labelNames: ['route'] })
  counter.add(1,{ route: '雪😀'.repeat(64) })
  let payload=''
  const first=new OtlpHttpMetricExporter(options(async (_url,init) => { payload=String(init!.body);return ok() }))
  await first.export(source.collect());await first.close()
  const send=vi.fn(async () => ok()),bounded=new OtlpHttpMetricExporter(options(send,{ maxRequestBytes: payload.length }))
  await expect(bounded.export(source.collect())).rejects.toMatchObject({ code: 'request-too-large' });expect(send).not.toHaveBeenCalled();await bounded.close()
  const original=fixture().collection,exporter=new OtlpHttpMetricExporter(options(send))
  const cases=[{ ...original.metrics[0]!,labelNames: new Array(1) },{ ...original.metrics[2]!,boundaries: new Array(3) },
    { ...original.metrics[2]!,series: [{ ...original.metrics[2]!.series[0]!,buckets: new Array(3) }] },
    { ...original.metrics[0]!,series: [{ ...original.metrics[0]!.series[0]!,labels: { route: '\ud800' } }] }]
  for (const metric of cases) await expect(exporter.export({ ...original,metrics: [metric] })).rejects.toMatchObject({ code: 'invalid-input' })
  expect(send).not.toHaveBeenCalled();await exporter.close()
  expect(() => new OtlpHttpMetricExporter(options(send,{ resourceAttributes: { invalid: '\ud800' } }))).toThrow('attribute')
})
it('retries identical frozen bytes, preserves admission ownership and closes once',async () => {
  let release!: () => void;const gate=new Promise<void>(resolve => { release=resolve }),bodies: string[]=[]
  const exporter=new OtlpHttpMetricExporter(options(async (_url,init) => {
    bodies.push(String(init!.body));if (bodies.length===1) { await gate;return new Response('',{ status: 503 }) };return ok()
  }))
  const { collection }=fixture(),pending=exporter.export(collection)
  await expect(exporter.export(collection)).rejects.toMatchObject({ code: 'busy' })
  const closing=exporter.close();expect(exporter.close()).toBe(closing)
  await expect(exporter.export(collection)).rejects.toMatchObject({ code: 'closed' })
  release();await pending;await closing
  expect(new Set(bodies).size).toBe(1);expect(exporter.stats()).toMatchObject({ closed: true,retries: 1,acceptedDataPoints: 3 })
})
it('shares bounded failure handling while retaining metric error types and sanitized metadata',async () => {
  for (const response of [ok({ partialSuccess: { rejectedDataPoints: '4' } }),ok({ partialSuccess: { rejectedDataPoints: -1 } }),new Response('private',{ status: 302 }),new Response('x'.repeat(128),{ headers: { 'Content-Type': 'application/json' } })]) {
    const send=vi.fn(async () => response),exporter=new OtlpHttpMetricExporter(options(send,{ maxResponseBytes: 64 }))
    await expect(exporter.export(fixture().collection)).rejects.toBeInstanceOf(OtlpMetricExportError)
    expect(send).toHaveBeenCalledTimes(1);await exporter.close()
  }
  let release!: (response: Response) => void
  const exporter=new OtlpHttpMetricExporter(options(async () => new Promise<Response>(resolve => { release=resolve }),{ timeoutMs: 15 }))
  await expect(exporter.export(fixture().collection)).rejects.toMatchObject({ code: 'timeout' })
  await expect(exporter.export(fixture().collection)).rejects.toMatchObject({ code: 'busy' })
  await exporter.close();release(ok());await vi.waitFor(() => expect(exporter.stats().pendingTransports).toBe(0))
  expect(exporter.stats().acceptedDataPoints).toBe(0)
})
