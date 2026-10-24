import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { rustReportBinary } from './rust-reports-tools.mjs'

const root = fileURLToPath(new URL('..', import.meta.url)), directory = await mkdtemp(join(tmpdir(), 'longhorn rust reports '))
const require = createRequire(import.meta.url), children = [], sockets = []
const bun = join(dirname(require.resolve('bun-runtime/package.json')), 'bin/bun.exe')
const deno = join(dirname(require.resolve('deno-runtime/package.json')), process.platform === 'win32' ? 'deno.exe' : 'deno')
const token = 'owned_native_reports_credential_1234567890', protocol = 'longhorn.reports.v1'
let worker
const demoChildren = new Set()
function launch(binary, args, extra = {}, ipc = false) {
  const env = { ...process.env, ...extra }
  const child = spawn(binary, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', ...(ipc ? ['ipc'] : [])] }), records = []
  if (ipc) child.on('message', message => { if (Number.isSafeInteger(message?.pid) && message.pid > 0) { if (message.action === 'opened') demoChildren.add(message.pid); else if (message.action === 'closed') demoChildren.delete(message.pid) } })
  let output = ''
  for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', line => { output += line + '\n'; try { records.push(JSON.parse(line)) } catch {} })
  child.on('error', () => { output += 'Owned child could not start\n' })
  const instance = { child, records, rawOutput: () => output, output: () => output.replaceAll(token, '[redacted]'), ended: new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal }))) }
  children.push(instance); return instance
}
async function waitFor(instance, action, timeout = 15_000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const value = await action(); if (value) return value
    if (instance && (instance.child.exitCode !== null || instance.child.signalCode !== null)) throw new Error(instance.output())
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Native report condition timed out: ' + (instance?.output() ?? ''))
}
async function finish(instance, signal) {
  if (signal) instance.child.kill(signal)
  const timer = setTimeout(() => instance.child.kill('SIGKILL'), 20_000)
  try { assert.deepEqual(await instance.ended, { code: 0, signal: null }, instance.output()); return instance.records }
  finally { clearTimeout(timer) }
}
async function native(port = 0, extra = {}) {
  const instance = launch(rustReportBinary, [], { LONGHORN_NATIVE_TOKEN: token, LONGHORN_NATIVE_HOST: '127.0.0.1', LONGHORN_NATIVE_PORT: String(port), LONGHORN_NATIVE_MAX_CONCURRENT: '1', LONGHORN_NATIVE_REQUEST_TIMEOUT_MS: '1000', ...extra })
  const ready = await waitFor(instance, () => instance.records.find(value => value.message === 'Native reports listening'))
  return Object.assign(instance, { url: ready.url, port: Number(new URL(ready.url).port) })
}
async function call(instance, path, options = {}) {
  const response = await fetch(instance.url + path, { ...options, headers: { Authorization: 'Bearer ' + token, ...options.headers }, signal: AbortSignal.timeout(5000) })
  return { status: response.status, data: await response.json() }
}
const post = value => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
function heldBody(instance) {
  const body = JSON.stringify({ numbers: [2, 4] })
  let responseBody = ''
  const request = httpRequest(instance.url + '/v1/reports', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Connection: 'close' } })
  sockets.push(request)
  const result = new Promise((resolve, reject) => {
    request.on('error', reject)
    request.on('response', response => { response.on('data', value => { responseBody += value }); response.on('end', () => { try { resolve({ status: response.statusCode, data: JSON.parse(responseBody) }) } catch (error) { reject(error) } }) })
  })
  result.catch(() => {})
  request.write(body.slice(0, -2)); request.flushHeaders()
  return { result, release: () => request.end(body.slice(-2)) }
}
const filename = join(directory, 'reports.sqlite')
async function jobs(service) {
  const instance = launch(process.execPath, ['examples/jobs/dist/index.js'], { HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'info', DATABASE_PATH: filename, WORKER_ENABLED: 'true', SCHEDULER_ENABLED: 'false',
    REPORTS_NATIVE_URL: service.url + '/', REPORTS_NATIVE_TOKEN: token, REPORTS_NATIVE_ALLOW_INSECURE_LOOPBACK: 'true', REPORTS_NATIVE_TIMEOUT_MS: '500',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '', OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: '', OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: '' })
  const ready = await waitFor(instance, () => instance.records.find(value => value.message === 'HTTP server listening'))
  return Object.assign(instance, { url: ready.fields.url })
}
async function reportAt(host, id) { const response = await fetch(host.url + '/reports/' + id); assert.equal(response.status, 200); return response.json() }
try {
  let service = await native()
  for (const invalid of [{ LONGHORN_NATIVE_TOKEN: '' }, { LONGHORN_NATIVE_HOST: '0.0.0.0' }, { LONGHORN_NATIVE_PORT: '65536' },
    { LONGHORN_NATIVE_MAX_CONCURRENT: '0' }, { LONGHORN_NATIVE_REQUEST_TIMEOUT_MS: '0' }, { LONGHORN_NATIVE_PORT: String(service.port) }]) {
    const rejected = launch(rustReportBinary, [], { LONGHORN_NATIVE_TOKEN: token, LONGHORN_NATIVE_HOST: '127.0.0.1', LONGHORN_NATIVE_PORT: '0', ...invalid })
    const timer = setTimeout(() => rejected.child.kill('SIGKILL'), 3000)
    try { assert.deepEqual(await rejected.ended, { code: 1, signal: null }, rejected.output()); assert.ok(!rejected.records.some(value => value.message === 'Native reports listening')) }
    finally { clearTimeout(timer) }
  }
  for (const credential of ['', 'Bearer wrong_private_credential']) {
    const response = await fetch(service.url + '/health', { headers: { Authorization: credential } })
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: 'unauthorized' })
  }
  assert.deepEqual(await call(service, '/health'), { status: 200, data: { protocol, status: 'ok' } })
  assert.deepEqual(await call(service, '/v1/reports', post({ numbers: [2, 4] })), { status: 200, data: { protocol, report: { count: 2, sum: 6, min: 2, max: 4 } } })
  for (const value of [{ numbers: [] }, { numbers: [1e13] }, { numbers: Array(1001).fill(0) }, { numbers: ['secret'] }, { numbers: [1], secret: token }]) assert.equal((await call(service, '/v1/reports', post(value))).status, 400)
  assert.equal((await call(service, '/v1/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(65537) })).status, 413)
  assert.equal((await call(service, '/v1/reports', { method: 'POST', body: '{}' })).status, 415)
  assert.equal((await call(service, '/v1/reports')).status, 405)
  const held = heldBody(service)
  await waitFor(service, async () => (await call(service, '/status')).data.active === 1)
  assert.equal((await call(service, '/v1/reports', post({ numbers: [1] }))).status, 503)
  held.release(); assert.equal((await held.result).status, 200)
  const timeout = heldBody(service)
  assert.equal((await timeout.result).status, 408)
  assert.equal((await call(service, '/status')).data.active, 0)
  console.log('Native Rust HTTP: authenticated versioned results, strict values/body bounds, actual concurrent admission and stalled-body timeout/release verified.')

  for (const [runtime, binary, flags] of [['node', process.execPath, []], ['bun', bun, []], ['deno', deno, ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual', '--allow-net=127.0.0.1', '--allow-env=NODE_ENV']]]) {
    const fixture = launch(binary, [...flags, 'scripts/fixtures/rust-report-client.mjs', service.url + '/', token])
    const records = await finish(fixture)
    assert.deepEqual(records.find(value => value.verified)?.report, { count: 3, sum: 3.5, min: -2, max: 4 })
    console.log(runtime + ': built portable native-report client computes through the real Rust socket.')
  }
  const bundle = join(directory, 'worker')
  await build({ entry: { worker: join(root, 'scripts/fixtures/rust-report-worker.mjs') }, outDir: bundle, bundle: true, splitting: false, platform: 'browser', target: 'es2022', format: ['esm'], silent: true })
  worker = new Miniflare({ modules: true, modulesRoot: bundle, scriptPath: join(bundle, 'worker.js'), compatibilityDate: '2025-07-18', cf: false, bindings: { SERVICE_URL: service.url + '/', SERVICE_TOKEN: token }, log: new Log(LogLevel.WARN) })
  const response = await worker.dispatchFetch('http://native.example/')
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { healthy: true, report: { count: 3, sum: 3.5, min: -2, max: 4 } })
  await worker.dispose(); worker = undefined
  console.log('Workers: browser-bundled client computes through actual workerd Fetch to Rust; no process spawning or native binding enters shared code.')

  let host = await jobs(service)
  const computedBefore = BigInt((await call(service, '/status')).data.completed)
  assert.equal((await fetch(host.url + '/readyz')).status, 200)
  const accepted = await fetch(host.url + '/reports', post({ numbers: [3, -1, 9] })); assert.equal(accepted.status, 202)
  const first = (await accepted.json()).job
  const result = await waitFor(host, async () => { const value = await reportAt(host, first.id); return value.job.state === 'succeeded' ? value : false })
  assert.deepEqual(result.report, { count: 3, sum: 11, min: -1, max: 9 })
  assert.ok(BigInt((await call(service, '/status')).data.completed) > computedBefore)
  const port = service.port
  await finish(service, 'SIGTERM')
  assert.equal((await fetch(host.url + '/readyz')).status, 503)
  const outage = await fetch(host.url + '/reports', post({ numbers: [5, 10] })); assert.equal(outage.status, 202)
  const queued = (await outage.json()).job
  await waitFor(host, async () => { const value = await reportAt(host, queued.id); assert.equal(value.report, null); return value.job.attempts >= 1 && value.job.state === 'pending' })
  service = await native(port)
  const recovered = await waitFor(host, async () => { const value = await reportAt(host, queued.id); return value.job.state === 'succeeded' ? value : false })
  assert.deepEqual(recovered.report, { count: 2, sum: 15, min: 5, max: 10 }); assert.ok(recovered.job.attempts >= 2)
  await finish(host, 'SIGTERM'); host = await jobs(service)
  assert.deepEqual((await reportAt(host, first.id)).report, result.report)
  assert.deepEqual((await reportAt(host, queued.id)).report, recovered.report)
  await finish(host, 'SIGTERM')
  console.log('Jobs: DI-selected Rust computation, persisted queue results, readiness failure, real service outage/retry/recovery and retained results after host restart verified.')

  const draining = heldBody(service)
  await waitFor(service, async () => (await call(service, '/status')).data.active === 1)
  service.child.kill('SIGTERM')
  await waitFor(service, () => service.records.some(value => value.message === 'Native reports draining'))
  assert.equal(service.child.exitCode, null)
  draining.release(); assert.equal((await draining.result).status, 200)
  await finish(service)
  assert.ok(service.records.some(value => value.message === 'Native reports stopped' && value.active === 0))
  assert.ok(children.every(child => !child.rawOutput().includes(token)))
  console.log('Native shutdown: SIGTERM retains an accepted partial request until real completion, then reports zero active work and releases the process.')
  const demo = launch(process.execPath, ['scripts/demo-rust-reports.mjs'], {}, true)
  const ready = await waitFor(demo, () => demo.records.find(value => value.message === 'Rust report demo ready'))
  assert.deepEqual(ready.report, { count: 3, sum: 11, min: -1, max: 9 })
  assert.ok(BigInt(ready.nativeCompleted) >= 1n)
  assert.equal((await fetch(ready.reportUrl)).status, 200)
  await finish(demo, 'SIGTERM')
  assert.ok(demo.records.some(value => value.message === 'Rust report demo stopped'))
  await assert.rejects(access(ready.temporaryStorage)); assert.equal(demoChildren.size, 0)
  console.log('Owned demo: random credentials, actual native/queued report, ordered host/service shutdown and temporary storage cleanup verified.')
  const direct = launch(process.execPath, ['scripts/serve-rust-reports.mjs'], { LONGHORN_NATIVE_TOKEN: token, LONGHORN_NATIVE_HOST: '127.0.0.1', LONGHORN_NATIVE_PORT: '0' }, true)
  const listener = await waitFor(direct, () => direct.records.find(value => value.message === 'Native reports listening'))
  assert.equal((await fetch(listener.url + '/health', { headers: { Authorization: 'Bearer ' + token } })).status, 200)
  await finish(direct, 'SIGTERM'); assert.equal(demoChildren.size, 0)
  assert.ok(children.every(child => !child.rawOutput().includes(token)))
  console.log('Native development launcher: locked build, actual authenticated listener and forwarded signal drain verified.')
} finally {
  sockets.forEach(socket => socket.destroy())
  for (const instance of children) if (instance.child.exitCode === null && instance.child.signalCode === null) instance.child.kill('SIGKILL')
  for (const pid of demoChildren) try { process.kill(pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  await Promise.allSettled(children.map(instance => instance.ended)); await worker?.dispose()
  await rm(directory, { recursive: true, force: true })
}
