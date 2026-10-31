import { afterEach,expect,it,vi } from 'vitest'
import { loadConfig } from '@longhornjs/config'
import { openSqlite } from '@longhornjs/node/sqlite'
import type { Longhorn } from '@longhornjs/core'
import { createJobsApp } from './app.js'
import { configSchema } from './config.js'
import { JobsDiagnostics } from './diagnostics.js'
const apps: Longhorn[]=[]
afterEach(async () => { for (const app of apps.splice(0)) await app.close();vi.unstubAllGlobals() })
it('keeps OTLP opt-in and normalizes explicit trace endpoint/headers without exposing bad values',async () => {
  expect(configSchema.parse({})).not.toHaveProperty('otlp')
  expect(configSchema.parse({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '',OTEL_SERVICE_NAME: '',OTEL_SERVICE_VERSION: '',OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: '' })).not.toHaveProperty('otlp')
  expect(configSchema.parse({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:4318/custom',OTEL_EXPORTER_OTLP_TRACES_HEADERS: 'authorization=Bearer%20test' }).otlp).toMatchObject({ endpoint: 'http://127.0.0.1:4318/custom',headers: { authorization: 'Bearer test' },serviceName: 'longhorn-jobs' })
  const error=await loadConfig(configSchema,{ OTEL_EXPORTER_OTLP_TRACES_HEADERS: 'authorization=private-secret;bad=metadata' }).catch(error => error)
  expect(error.name).toBe('ConfigError');expect(String(error)).not.toContain('private-secret')
})
it('connects configured remote export to reports/diagnostics and isolates telemetry failure from readiness and work',async () => {
  const send=vi.fn(async () => new Response('private collector details',{ status: 503 }));vi.stubGlobal('fetch',send)
  const database=await openSqlite({ filename: ':memory:' })
  const app=createJobsApp(configSchema.parse({ WORKER_ENABLED: 'false',SCHEDULER_ENABLED: 'false',OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:4318/v1/traces',OTEL_EXPORTER_OTLP_TRACES_HEADERS: 'authorization=Bearer%20private-secret',OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: '10' }),{ openDatabase: async () => database });apps.push(app)
  const response=await app.fetch(new Request('http://localhost/reports',{ method: 'POST',headers: { 'Content-Type': 'application/json' },body: '{"numbers":[2,3]}' }))
  expect(response.status).toBe(202);await app.container.resolve(JobsDiagnostics).tracer.flush()
  expect((await app.fetch(new Request('http://localhost/readyz'))).status).toBe(200)
  const diagnostics=await(await app.fetch(new Request('http://localhost/diagnostics'))).json()
  expect(diagnostics.otlp.failedBatches).toBeGreaterThan(0)
  expect(JSON.stringify(diagnostics)).not.toContain('private-secret');expect(JSON.stringify(diagnostics)).not.toContain('127.0.0.1:4318')
  const traces=await(await app.fetch(new Request('http://localhost/traces'))).json()
  expect(traces.spans).toEqual([]);expect(traces.stats.exportErrors).toBeGreaterThan(0)
})
