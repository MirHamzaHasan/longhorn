import { localReportTestEnvironment } from './local-report-test-environment.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { Miniflare, Log, LogLevel } from 'miniflare'
const root = fileURLToPath(new URL('..', import.meta.url)), require = createRequire(import.meta.url)
const bun = join(dirname(require.resolve('bun-runtime/package.json')), 'bin/bun.exe')
const deno = join(dirname(require.resolve('deno-runtime/package.json')), process.platform === 'win32' ? 'deno.exe' : 'deno')
const temporary = await mkdtemp(join(tmpdir(), 'longhorn-observability-')), instances = []
function launch(binary, args, environment = {}) {
  const child = spawn(binary, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env,...localReportTestEnvironment, HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'info', SHUTDOWN_GRACE_MS: '500',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '',OTEL_EXPORTER_OTLP_TRACES_HEADERS: '',OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: '10000',OTEL_SERVICE_NAME: 'longhorn-test',OTEL_SERVICE_VERSION: '',...environment,
  } })
  let output = ''; const records = []
  createInterface({ input: child.stdout }).on('line', (line) => { output += `${line}\n`; try { records.push(JSON.parse(line)) } catch { /* Keep diagnostics. */ } })
  child.stderr.on('data', (chunk) => { output += chunk }); child.on('error', (error) => { output += String(error) })
  const ended = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })))
  const instance = { child, records, ended, output: () => output }; instances.push(instance); return instance
}
async function completed(instance) {
  const timer = setTimeout(() => instance.child.kill('SIGKILL'), 20000)
  try { const result = await instance.ended; assert.equal(result.code, 0, instance.output()); return instance.records } finally { clearTimeout(timer) }
}
async function record(instance, predicate) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const result = instance.records.find(predicate); if (result) return result
    if (instance.child.exitCode !== null || instance.child.signalCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Missing child record: ${instance.output()}`)
}
async function dispose(instance) {
  if (instance.child.exitCode === null && instance.child.signalCode === null) instance.child.kill('SIGKILL')
  await instance.ended
}
const request = (url, path, options) => fetch(`${url}${path}`, { ...options, signal: AbortSignal.timeout(5000) })
const json = async (url, path) => (await request(url, path)).json()
try {
  for (const [runtime, binary, flags] of [
    ['node', process.execPath, []], ['bun', bun, []], ['deno', deno, ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual']],
  ]) {
    const records = await completed(launch(binary, [...flags, join(root, 'scripts/fixtures/run-observability.mjs')]))
    assert.ok(records.some((value) => value.runtime === runtime && value.verified))
    console.log(`${runtime}: built health, bounded checks/metrics, trace context/hierarchy, privacy, failed export isolation and drain verified.`)
  }
  const bundle = join(temporary, 'worker')
  await build({ entry: { worker: join(root, 'scripts/fixtures/observability-worker.mjs') }, outDir: bundle,
    bundle: true, splitting: false, platform: 'browser', target: 'es2022', format: ['esm'], silent: true })
  const worker = new Miniflare({ modules: true, modulesRoot: bundle, scriptPath: join(bundle, 'worker.js'),
    host: '127.0.0.1', port: 0, cf: false, compatibilityDate: '2025-07-18', log: new Log(LogLevel.NONE) })
  try {
    const response = await worker.dispatchFetch('https://observability.example/verify')
    assert.equal(response.status, 200, await response.clone().text())
    assert.deepEqual(await response.json(), { verified: true, readiness: true, bounded: true, metrics: true, tracing: true, private: true, drained: true })
    console.log('workers: the same bounded observability contract executes in actual workerd from a browser bundle.')
  } finally { await worker.dispose() }

  const fixture = launch(process.execPath, [join(root, 'scripts/fixtures/observability-host.mjs')])
  const url = (await record(fixture, (value) => value.url)).url
  assert.equal((await request(url, '/readyz')).status, 200)
  await request(url, '/fixture/unhealthy', { method: 'POST' })
  assert.equal((await request(url, '/readyz')).status, 503); assert.equal((await request(url, '/livez')).status, 200)
  await request(url, '/fixture/healthy', { method: 'POST' })
  assert.equal((await request(url, '/readyz')).status, 200)
  const traceId = '4bf92f3577b34da6a3ce929d0e0e4736', parentId = '00f067aa0ba902b7'
  const response = await request(url, '/items/private-item?token=private-query', { headers: { traceparent: `00-${traceId}-${parentId}-01` } })
  assert.equal(response.status, 200); assert.ok(response.headers.get('traceparent').startsWith(`00-${traceId}-`))
  for (let index = 0; index < 20; index++) await request(url, `/unknown-private-${index}`)
  assert.equal((await request(url, '/failure')).status, 500)
  const metrics = await (await request(url, '/metrics')).text(), traces = await json(url, '/traces')
  assert.ok(metrics.includes('route="_unmatched",status="404"} 20'))
  assert.ok(metrics.includes('route="/failure",status="500"} 1'))
  assert.equal(traces.spans.find((span) => span.name === 'GET /items/:id').parentSpanId, parentId)
  for (const secret of ['private-item', 'private-query', 'unknown-private-', 'Expected fixture failure']) assert.ok(!(metrics + JSON.stringify(traces)).includes(secret))
  fixture.child.kill('SIGTERM'); await record(fixture, (value) => value.draining)
  assert.equal((await request(url, '/readyz')).status, 503); assert.equal((await request(url, '/livez')).status, 200)
  await completed(fixture)
  assert.ok(fixture.records.some((value) => value.stopped && value.tracesClosed))
  await assert.rejects(request(url, '/readyz'))
  console.log('Native HTTP: unhealthy/recovered dependencies, liveness separation, bounded unknown routes, errors, trace correlation, draining readiness and final exporter cleanup verified.')

  const host = launch(process.execPath, [join(root, 'examples/jobs/dist/index.js')], { DATABASE_PATH: join(temporary, 'jobs.sqlite'), WORKER_ENABLED: 'true', SCHEDULER_ENABLED: 'true' })
  const address = (await record(host, (value) => value.message === 'HTTP server listening')).fields.url
  assert.equal((await request(address, '/readyz')).status, 200)
  const created = await request(address, '/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ numbers: [3, 7] }) })
  assert.equal(created.status, 202)
  const { job } = await created.json(), deadline = Date.now() + 5000
  while (true) {
    const status = await json(address, `/reports/${job.id}`)
    if (status.job.state === 'succeeded') { assert.equal(status.report.sum, 10); break }
    assert.ok(Date.now() < deadline, 'Observed worker did not process the report')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const jobMetrics = await (await request(address, '/metrics')).text(), jobTraces = await json(address, '/traces')
  assert.ok(jobMetrics.includes('longhorn_job_handlers_total{outcome="returned"} 1'))
  assert.ok(jobMetrics.includes('longhorn_background_active{component="worker"}'))
  assert.ok(jobTraces.spans.some((span) => span.name === 'reports.enqueue' && span.kind === 'producer'))
  assert.ok(jobTraces.spans.some((span) => span.name === 'reports.process' && span.kind === 'consumer'))
  assert.ok(!JSON.stringify(jobTraces).includes(job.id))
  assert.ok(host.records.some((record) => record.message === 'HTTP request completed' && record.fields.traceId && record.fields.spanId))
  host.child.kill('SIGTERM'); await record(host, (value) => value.message === 'Application draining')
  assert.equal((await request(address, '/readyz')).status, 503); assert.equal((await request(address, '/livez')).status, 200)
  await completed(host)
  assert.ok(host.records.some((record) => record.message === 'Application stopped'))
  console.log('Reports: database/background readiness, handler/worker metrics, producer/consumer spans, enriched logs, and graceful drain remain connected to real persisted work.')
} finally { await Promise.all(instances.map(dispose)); await rm(temporary, { recursive: true, force: true }) }
