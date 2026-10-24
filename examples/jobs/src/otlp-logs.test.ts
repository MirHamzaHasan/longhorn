import { afterEach,expect,it,vi } from 'vitest'
import { loadConfig } from '@longhorn/config'
import { openSqlite } from '@longhorn/node/sqlite'
import type { Longhorn } from '@longhorn/core'
import type { LogRecord } from '@longhorn/logger'
import type { LogEntry } from '@longhorn/observability'
import { createJobsLogging } from './logging.js'
import { configSchema } from './config.js'
import { createJobsApp } from './app.js'
import { JobsDiagnostics } from './diagnostics.js'
const apps:Longhorn[]=[]
afterEach(async()=>{for(const app of apps.splice(0))await app.close();vi.unstubAllGlobals()})
it('keeps logs independently opt-in, validates secret-bearing configuration and shares resource identity',async()=>{
  expect(configSchema.parse({})).not.toHaveProperty('otlpLogs')
  const config=configSchema.parse({OTEL_EXPORTER_OTLP_LOGS_ENDPOINT:'https://collector.example/v1/logs',OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:'https://collector.example/v1/traces',OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:'https://collector.example/v1/metrics',OTEL_EXPORTER_OTLP_LOGS_HEADERS:'authorization=Bearer%20test'})
  expect(config.otlpLogs!.resourceAttributes).toEqual(config.otlp!.resourceAttributes);expect(config.otlpLogs!.resourceAttributes).toEqual(config.otlpMetrics!.resourceAttributes)
  expect(config.otlpLogs!.headers.authorization).toBe('Bearer test')
  const error=await loadConfig(configSchema,{OTEL_EXPORTER_OTLP_LOGS_ENDPOINT:'https://private:secret@collector.example/v1/logs'}).catch(error=>error)
  expect(error.name).toBe('ConfigError');expect(String(error)).not.toContain('secret')
})
it('preserves full local output, projects remote metadata and drains the final stop hook after diagnostics',async()=>{
  const local:LogRecord[]=[],entries:LogEntry[]=[],close=vi.fn(async()=>{})
  const config=configSchema.parse({WORKER_ENABLED:'false',SCHEDULER_ENABLED:'false'}),logging=createJobsLogging(config,{localSink:record=>local.push(record),exporter:{export:async batch=>{entries.push(...batch)},close}})
  const db=await openSqlite({filename:':memory:'}),app=createJobsApp(config,{logger:logging.logger,logs:logging.processor!,openDatabase:async()=>db});apps.push(app)
  app.onStop(()=>logging.logger.info('Final application event',{secret:'private',privateField:'private'}))
  const response=await app.fetch(new Request('http://localhost/health?private-query=secret'));expect(response.status).toBe(200)
  await logging.processor!.flush();const http=entries.find(e=>e.record.message==='HTTP request completed')!
  expect(http.context).toMatchObject({sampled:true});expect(http.record.fields.method).toBe('GET');expect(http.record.fields).not.toHaveProperty('path');expect(http.record.fields).not.toHaveProperty('requestId')
  expect(local.find(r=>r.message==='HTTP request completed')!.fields.path).toBe('/health')
  await app.close();expect(close).toHaveBeenCalledTimes(1);expect(logging.processor!.stats().closed).toBe(true)
  expect(entries.at(-1)!.record.message).toBe('Final application event');expect(JSON.stringify(entries)).not.toContain('private')
})
it('keeps persisted work and readiness successful during log export failure and reports failure locally without feedback',async()=>{
  const local:LogRecord[]=[],config=configSchema.parse({WORKER_ENABLED:'false',SCHEDULER_ENABLED:'false'})
  const logging=createJobsLogging(config,{localSink:record=>local.push(record),exporter:{export:async()=>{throw new Error('private collector')},close:async()=>{}}})
  const db=await openSqlite({filename:':memory:'}),app=createJobsApp(config,{logger:logging.logger,logs:logging.processor!,openDatabase:async()=>db});apps.push(app)
  expect((await app.fetch(new Request('http://localhost/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"numbers":[1,2]}'}))).status).toBe(202)
  await logging.processor!.flush();expect((await app.fetch(new Request('http://localhost/readyz'))).status).toBe(200)
  const diagnostics=await(await app.fetch(new Request('http://localhost/diagnostics'))).json();expect(diagnostics.logs.failedBatches).toBeGreaterThan(0)
  expect(local.some(r=>r.message==='Log export failed')).toBe(true);expect(local.filter(r=>r.message==='Log export failed').every(r=>r.fields.operation==='export')).toBe(true)
  expect(JSON.stringify(diagnostics)).not.toContain('private collector')
})
