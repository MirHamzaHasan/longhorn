import { afterEach,expect,it,vi } from 'vitest'
import { MetricRegistry } from './metrics.js'
import type { MetricCollection,MetricExporter } from './metrics.js'
import { MetricReaderError,PeriodicMetricReader } from './metric-reader.js'
afterEach(() => vi.useRealTimers())
function fixture() { const source=new MetricRegistry(),counter=source.counter({ name: 'count',help: 'Count.',labelNames: ['route'] });return { source,counter } }
it('splits by data point count across a family, serially preserves timestamps and finishes a collection before the next',async () => {
  const { source,counter }=fixture();for (let i=0;i<5;i++) counter.add(i,{ route: String(i) })
  const batches: MetricCollection[]=[],exporter={ export: vi.fn(async (batch: MetricCollection) => { batches.push(batch) }),close: vi.fn(async () => {}) }
  const reader=new PeriodicMetricReader({ source,exporter,maxDataPointsPerBatch: 2 })
  await reader.flush()
  expect(batches.map(b=>b.metrics.reduce((n,m)=>n+m.series.length,0))).toEqual([2,2,1])
  expect(new Set(batches.map(b=>b.startedAt)).size).toBe(1);expect(new Set(batches.map(b=>b.collectedAt)).size).toBe(1)
  expect(batches.flatMap(b=>b.metrics.flatMap(m=>m.series.map(s=>s.labels.route)))).toEqual(['0','1','2','3','4'])
  expect(reader.stats()).toMatchObject({ collections: 1,batches: 3,exportedDataPoints: 5 })
  const closing=reader.close();expect(reader.close()).toBe(closing);await closing;expect(exporter.close).toHaveBeenCalledTimes(1)
  expect(reader.stats()).toMatchObject({ state: 'closed',collections: 2,batches: 6,exportedDataPoints: 10 })
})
it('coalesces flush requests behind active I/O into a fresh collection and includes final updates on close',async () => {
  const { source,counter }=fixture();counter.add(1,{ route: '/' })
  let release!: () => void;const gate=new Promise<void>(resolve=>{release=resolve}),values: number[]=[]
  const exporter={ export: vi.fn(async (batch: MetricCollection) => { values.push(batch.metrics[0]!.series[0]!.value);if (values.length===1) await gate }),close: vi.fn(async () => {}) }
  const reader=new PeriodicMetricReader({ source,exporter }),first=reader.flush()
  await vi.waitFor(()=>expect(values).toEqual([1]));counter.add(2,{ route: '/' })
  const second=reader.flush();expect(second).toBe(first);for(let i=0;i<100;i++)expect(reader.flush()).toBe(first)
  const closing=reader.close();await expect(reader.flush()).rejects.toMatchObject({ operation: 'closed' });expect(()=>reader.start()).toThrow(MetricReaderError)
  release();await first;await closing
  expect(values).toEqual([1,3]);expect(exporter.close).toHaveBeenCalledTimes(1);expect(reader.stats().queued).toBe(false)
})
it('starts explicitly, schedules from completion without overlapping a blocked exporter and cancels timers at close',async () => {
  vi.useFakeTimers();const { source,counter }=fixture();counter.add(1,{ route: '/' })
  let release!: () => void;const gate=new Promise<void>(resolve=>{release=resolve})
  const exporter={ export: vi.fn(async () => gate),close: vi.fn(async () => {}) },reader=new PeriodicMetricReader({ source,exporter,intervalMs: 10 })
  await vi.advanceTimersByTimeAsync(100);expect(exporter.export).not.toHaveBeenCalled()
  reader.start();reader.start();await vi.advanceTimersByTimeAsync(100);expect(exporter.export).toHaveBeenCalledTimes(1)
  release();await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(10);expect(exporter.export).toHaveBeenCalledTimes(2)
  await reader.close();const calls=exporter.export.mock.calls.length;await vi.advanceTimersByTimeAsync(100);expect(exporter.export).toHaveBeenCalledTimes(calls)
  expect(vi.getTimerCount()).toBe(0)
})
it('isolates periodic/final failures, preserves source totals for recovery and sanitizes callbacks',async () => {
  const { source,counter }=fixture();counter.add(1,{ route: '/' });let unavailable=true
  const seen: MetricReaderError[]=[],values: number[]=[]
  const exporter={ export: vi.fn(async (batch: MetricCollection) => { values.push(batch.metrics[0]!.series[0]!.value);if(unavailable)throw new Error('private endpoint') }),close: vi.fn(async () => {}) }
  const reader=new PeriodicMetricReader({ source,exporter,onError: error=>{seen.push(error);throw new Error('observer failure')} })
  await expect(reader.flush()).rejects.toMatchObject({ operation: 'export' });counter.add(2,{ route: '/' });unavailable=false;await reader.flush()
  expect(values).toEqual([1,3]);unavailable=true;await reader.close()
  expect(reader.stats()).toMatchObject({ state: 'closed',failedCollections: 2,exportedDataPoints: 1 })
  expect(seen).toHaveLength(2);expect(JSON.stringify(seen)).not.toContain('private')
})
it('rejects excessive collections before the first export and always releases its exporter on final collection failure',async () => {
  const { source,counter }=fixture();counter.add(1,{ route: 'a' });counter.add(1,{ route: 'b' })
  const exporter={ export: vi.fn(async () => {}),close: vi.fn(async () => {}) },reader=new PeriodicMetricReader({ source,exporter,maxDataPointsPerCollection: 1 })
  await expect(reader.flush()).rejects.toMatchObject({ operation: 'collect' });await reader.close();expect(exporter.export).not.toHaveBeenCalled();expect(exporter.close).toHaveBeenCalledTimes(1)
  const broken: MetricExporter={ export: async () => {},close: async () => { throw new Error('private close') } }
  const other=new PeriodicMetricReader({ source,exporter: broken });await expect(other.close()).rejects.toMatchObject({ operation: 'close' });expect(other.stats().state).toBe('closed')
})
