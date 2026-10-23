import type { MetricCollection,MetricExporter,MetricSnapshot,MetricSource } from './metrics.js'

export class MetricReaderError extends Error {
  constructor(readonly operation: 'collect' | 'export' | 'close' | 'closed') { super('Metric reader failed: '+operation);this.name='MetricReaderError' }
}
export type PeriodicMetricReaderOptions = {
  readonly source: MetricSource
  /** Exclusively owned; accepted exports must settle for cooperative close. */
  readonly exporter: MetricExporter
  readonly intervalMs?: number
  readonly maxDataPointsPerBatch?: number
  readonly maxDataPointsPerCollection?: number
  readonly onError?: (error: MetricReaderError) => void
}
function limit(value: number,maximum: number): number { if (!Number.isSafeInteger(value) || value<1 || value>maximum) throw new RangeError('Invalid metric reader limit');return value }
/** Explicit start; completion-relative ticks, one collection/export at a time, no sample queue. */
export class PeriodicMetricReader {
  private readonly source: MetricSource
  private readonly exporter: MetricExporter
  private readonly interval: number
  private readonly batchSize: number
  private readonly maximum: number
  private readonly onError: PeriodicMetricReaderOptions['onError']
  private timer: ReturnType<typeof setTimeout> | undefined
  private active: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private state: 'idle' | 'running' | 'closing' | 'closed' = 'idle'
  private requested=0
  private collected=0
  private collections=0
  private failures=0
  private batches=0
  private exported=0
  constructor(options: PeriodicMetricReaderOptions) {
    if (typeof options.source?.collect!=='function' || typeof options.exporter?.export!=='function' || typeof options.exporter.close!=='function') throw new TypeError('Invalid metric reader resources')
    this.source=options.source;this.exporter=options.exporter;this.onError=options.onError
    this.interval=limit(options.intervalMs ?? 60000,3600000)
    this.batchSize=limit(options.maxDataPointsPerBatch ?? 1000,10000)
    this.maximum=limit(options.maxDataPointsPerCollection ?? 10000,100000)
  }
  stats() { return { state: this.state,active: this.active!==undefined,queued: this.requested>this.collected,collections: this.collections,failedCollections: this.failures,batches: this.batches,exportedDataPoints: this.exported } }
  start(): void {
    if (this.state==='closed' || this.state==='closing') throw new MetricReaderError('closed')
    if (this.state==='running') return
    this.state='running';this.schedule()
  }
  private schedule(): void {
    if (this.state!=='running' || this.timer!==undefined) return
    this.timer=setTimeout(() => {
      this.timer=undefined
      void this.flush().catch(() => {}).finally(() => this.schedule())
    },this.interval)
  }
  flush(): Promise<void> {
    if (this.state==='closing' || this.state==='closed') return Promise.reject(new MetricReaderError('closed'))
    return this.request()
  }
  private report(error: MetricReaderError): void { try { this.onError?.(error) } catch {} }
  private request(): Promise<void> {
    this.requested++
    if (this.active) return this.active
    const work=Promise.resolve().then(async () => {
      let failure: MetricReaderError | undefined
      while (this.collected<this.requested) {
        this.collected=this.requested
        this.collections++
        let operation: 'collect' | 'export'='collect'
        try {
          const collection=this.source.collect()
          const batches=this.split(collection)
          operation='export'
          for (const batch of batches) {
            this.batches++;await this.exporter.export(batch)
            this.exported+=batch.metrics.reduce((sum,metric) => sum+metric.series.length,0)
          }
        } catch {
          const error=new MetricReaderError(operation);failure ??= error;this.failures++;this.report(error)
        }
      }
      if (failure) throw failure
    }).finally(() => { this.active=undefined })
    this.active=work;return work
  }
  private split(collection: MetricCollection): Iterable<MetricCollection> {
    if (!collection || !Array.isArray(collection.metrics) || collection.metrics.length>10000) throw new Error('Invalid metric collection')
    let total=0
    for (const metric of collection.metrics) {
      if (!metric || !Array.isArray(metric.series)) throw new Error('Invalid metric series')
      total+=metric.series.length;if (total>this.maximum) throw new Error('Metric collection capacity exceeded')
    }
    const batchSize=this.batchSize
    return (function* () {
      let metrics: MetricSnapshot[]=[],size=0
      for (const metric of collection.metrics) {
        for (let offset=0;offset<metric.series.length;) {
          const series=metric.series.slice(offset,offset+batchSize-size);offset+=series.length;size+=series.length
          metrics.push({ ...metric,series })
          if (size===batchSize) { yield { ...collection,metrics };metrics=[];size=0 }
        }
      }
      if (size) yield { ...collection,metrics }
    })()
  }
  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.state='closing'
      if (this.timer!==undefined) { clearTimeout(this.timer);this.timer=undefined }
      try { await this.request() } catch { /* Reported final collection failures are best effort. */ }
      try { await this.exporter.close() }
      catch { const error=new MetricReaderError('close');this.report(error);throw error }
      finally { this.state='closed' }
    })()
  }
}
