import { MetricRegistry } from './metrics.js'
import type { SpanContext } from './tracing.js'
import type { MetricCollection,MetricExporter } from './metrics.js'
import { PeriodicMetricReader } from './metric-reader.js'
import { OtlpHttpMetricExporter } from './otlp-metrics.js'
import { BufferedLogProcessor } from './logs.js'
import { OtlpHttpLogExporter } from './otlp-logs.js'
import type { LogEntry,LogExporter } from './logs.js'
const metrics = new MetricRegistry()
const counter = metrics.counter({ name: 'requests', help: 'Requests.', labelNames: ['method', 'route'] })
counter.add(1, { method: 'GET', route: '/items/:id' })
// @ts-expect-error Missing declared labels.
counter.add(1)
// @ts-expect-error Missing route label.
counter.add(1, { method: 'GET' })
// @ts-expect-error Undeclared labels are not part of the contract.
counter.add(1, { method: 'GET', route: '/', requestId: 'unbounded' })
// @ts-expect-error Metric labels are strings.
counter.add(1, { method: 1, route: '/' })
// @ts-expect-error Sampling is a boolean, not a raw flags string.
const invalid: SpanContext = { traceId: 'id', spanId: 'span', sampled: '01' }
void invalid

function verifyLogTypes(entry:LogEntry):void {
  const exporter:LogExporter=new OtlpHttpLogExporter({endpoint:'https://collector.example/v1/logs',serviceName:'types'})
  const processor=new BufferedLogProcessor({exporter});processor.sink(entry.record)
  void exporter.export([entry])
  // @ts-expect-error A normalized logger record still needs observation metadata.
  void exporter.export([entry.record])
  // @ts-expect-error Explicit correlation must use a complete typed span context.
  processor.emit(entry.record,{traceId:'id',spanId:'span'})
}

function verifyMetricExportTypes(): void {
  const exporter: MetricExporter=new OtlpHttpMetricExporter({ endpoint: 'https://collector.example/v1/metrics',serviceName: 'types' })
  const collection: MetricCollection=metrics.collect()
  void exporter.export(collection)
  // @ts-expect-error An old snapshot has no cumulative time identity.
  void exporter.export(metrics.snapshot())
  // @ts-expect-error An exporter cannot invent a delta/reset option for cumulative data.
  void exporter.export({ ...collection,temporality: 'delta' })
  const reader=new PeriodicMetricReader({ source: metrics,exporter,maxDataPointsPerBatch: 100 })
  void reader.flush()
}
