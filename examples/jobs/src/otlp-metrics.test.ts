import { afterEach,expect,it,vi } from 'vitest'
import { loadConfig } from '@longhornjs/config'
import { openSqlite } from '@longhornjs/node/sqlite'
import type { Longhorn } from '@longhornjs/core'
import type { MetricCollection } from '@longhornjs/observability'
import { createJobsApp } from './app.js'
import { configSchema } from './config.js'
import { JobsDiagnostics } from './diagnostics.js'
const apps: Longhorn[]=[]
afterEach(async()=>{for(const app of apps.splice(0))await app.close();vi.unstubAllGlobals()})
it('selects metric push independently of traces with explicit headers, instance identity and validated timing',async()=>{
  expect(configSchema.parse({})).not.toHaveProperty('otlpMetrics')
  const config=configSchema.parse({OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:'http://127.0.0.1:4318/v1/metrics',OTEL_EXPORTER_OTLP_METRICS_HEADERS:'authorization=Bearer%20test',OTEL_METRIC_EXPORT_INTERVAL:'100',OTEL_SERVICE_INSTANCE_ID:'one-instance'})
  expect(config).not.toHaveProperty('otlp');expect(config).toMatchObject({metricExportIntervalMs:100,otlpMetrics:{headers:{authorization:'Bearer test'},resourceAttributes:{'service.instance.id':'one-instance'}}})
  const first=configSchema.parse({OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:'https://collector.example/v1/metrics'}),second=configSchema.parse({OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:'https://collector.example/v1/metrics'})
  expect(first.otlpMetrics!.resourceAttributes['service.instance.id']).not.toBe(second.otlpMetrics!.resourceAttributes['service.instance.id'])
  const together=configSchema.parse({OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:'https://collector.example/v1/metrics',OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:'https://collector.example/v1/traces'})
  expect(together.otlp!.resourceAttributes).toEqual(together.otlpMetrics!.resourceAttributes)
  for(const input of [{OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:'https://private:secret@host/v1/metrics'},{OTEL_EXPORTER_OTLP_METRICS_HEADERS:'authorization=private-secret;metadata=bad'},{OTEL_METRIC_EXPORT_INTERVAL:'0'}]){
    const error=await loadConfig(configSchema,input).catch(error=>error);expect(error.name).toBe('ConfigError');expect(String(error)).not.toContain('secret')
  }
})
it('refreshes background gauges for push without scraping, keeps Prometheus and memory traces, and flushes after shutdown',async()=>{
  const batches:MetricCollection[]=[],close=vi.fn(async()=>{}),database=await openSqlite({filename:':memory:'})
  const app=createJobsApp(configSchema.parse({WORKER_ENABLED:'false',SCHEDULER_ENABLED:'false'}),{openDatabase:async()=>database,metricExporter:{export:async batch=>{batches.push(batch)},close}});apps.push(app)
  expect((await app.fetch(new Request('http://localhost/health'))).status).toBe(200)
  const diagnostics=app.container.resolve(JobsDiagnostics);await diagnostics.metricReader!.flush()
  expect(batches[0]!.metrics.find(m=>m.name==='longhorn_background_active')!.series).toMatchObject([{labels:{component:'worker'},value:0},{labels:{component:'scheduler'},value:0}])
  expect(batches[0]!.metrics.some(m=>m.name==='longhorn_http_requests_total')).toBe(true)
  expect(await(await app.fetch(new Request('http://localhost/metrics'))).text()).toContain('longhorn_background_active')
  const traces=await(await app.fetch(new Request('http://localhost/traces'))).json();expect(traces.spans.length).toBeGreaterThan(0)
  await app.close();expect(close).toHaveBeenCalledTimes(1);expect(diagnostics.metricReader!.stats().state).toBe('closed');expect(diagnostics.meter.stats().closed).toBe(true)
  expect(batches.at(-1)!.metrics.some(m=>m.name==='longhorn_http_requests_total')).toBe(true)
})
it('isolates a failed collector from report acceptance/readiness and exposes sanitized exporter counters',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('private collector detail',{status:500})))
  const database=await openSqlite({filename:':memory:'}),app=createJobsApp(configSchema.parse({WORKER_ENABLED:'false',SCHEDULER_ENABLED:'false',OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:'http://127.0.0.1:4318/v1/metrics',OTEL_EXPORTER_OTLP_METRICS_HEADERS:'authorization=Bearer%20private-secret'}),{openDatabase:async()=>database});apps.push(app)
  expect((await app.fetch(new Request('http://localhost/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"numbers":[2,3]}'}))).status).toBe(202)
  await expect(app.container.resolve(JobsDiagnostics).metricReader!.flush()).rejects.toMatchObject({operation:'export'})
  expect((await app.fetch(new Request('http://localhost/readyz'))).status).toBe(200)
  const diagnostics=await(await app.fetch(new Request('http://localhost/diagnostics'))).json()
  expect(diagnostics.otlpMetrics.failedBatches).toBe(1);expect(diagnostics.metricReader.failedCollections).toBe(1)
  for(const secret of ['private-secret','collector detail','4318'])expect(JSON.stringify(diagnostics)).not.toContain(secret)
})
