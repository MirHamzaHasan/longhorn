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

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const bun = join(dirname(require.resolve('bun-runtime/package.json')), 'bin/bun.exe')
const deno = join(dirname(require.resolve('deno-runtime/package.json')), process.platform === 'win32' ? 'deno.exe' : 'deno')
const temporary = await mkdtemp(join(tmpdir(), 'longhorn-queues-'))
const instances = []
function launch(binary, args, environment = {}) {
  const child = spawn(binary, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'info',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '',OTEL_EXPORTER_OTLP_TRACES_HEADERS: '',OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: '10000',OTEL_SERVICE_NAME: 'longhorn-test',OTEL_SERVICE_VERSION: '',...environment,
  } })
  let output = ''
  const records = []
  createInterface({ input: child.stdout }).on('line', (line) => {
    output += `${line}\n`; try { records.push(JSON.parse(line)) } catch { /* Keep diagnostics. */ }
  })
  child.stderr.on('data', (chunk) => { output += chunk })
  child.on('error', (error) => { output += `${error.stack ?? error}\n` })
  const ended = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })))
  const instance = { child, records, ended, output: () => output }; instances.push(instance); return instance
}
async function completed(instance, killed = false) {
  const timer = setTimeout(() => instance.child.kill('SIGKILL'), 20000)
  try {
    const result = await instance.ended
    if (killed) assert.equal(result.signal, 'SIGKILL', instance.output())
    else assert.equal(result.code, 0, instance.output())
    return instance.records
  } finally { clearTimeout(timer) }
}
async function record(instance, predicate) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const result = instance.records.find(predicate)
    if (result) return result
    if (instance.child.exitCode !== null || instance.child.signalCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Expected child record missing: ${instance.output()}`)
}
async function stop(instance) {
  if (instance.child.exitCode !== null || instance.child.signalCode !== null) { await instance.ended; return }
  instance.child.kill('SIGTERM'); await completed(instance)
}
const fixture = (mode, filename, ...args) => launch(process.execPath, [join(root, 'scripts/fixtures/queue-process.mjs'), mode, filename, ...args])
async function inspect(filename) { return (await completed(fixture('inspect', filename)))[0] }
async function crash(filename) {
  const instance = fixture('crash', filename)
  await record(instance, (value) => value.claimed)
  instance.child.kill('SIGKILL'); await completed(instance, true)
}
const request = (url, path, options) => fetch(`${url}${path}`, { ...options, signal: AbortSignal.timeout(5000) })
async function host(filename, enabled) {
  const instance = launch(process.execPath, [join(root, 'examples/jobs/dist/index.js')], { DATABASE_PATH: filename, WORKER_ENABLED: String(enabled) })
  const listening = await record(instance, (value) => value.message === 'HTTP server listening')
  return { instance, url: listening.fields.url }
}
try {
  for (const [runtime, binary, flags] of [
    ['node', process.execPath, []], ['bun', bun, []], ['deno', deno, ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual']],
  ]) {
    const records = await completed(launch(binary, [...flags, join(root, 'scripts/fixtures/run-queue.mjs')]))
    assert.ok(records.some((value) => value.runtime === runtime && value.verified))
    console.log(`${runtime}: built queue contract verifies delays, retries, lease fencing, status isolation, and draining.`)
  }
  const bundle = join(temporary, 'worker')
  await build({ entry: { worker: join(root, 'scripts/fixtures/queue-worker.mjs') }, outDir: bundle,
    bundle: true, splitting: false, platform: 'browser', target: 'es2022', format: ['esm'], silent: true })
  const worker = new Miniflare({ modules: true, modulesRoot: bundle, scriptPath: join(bundle, 'worker.js'),
    host: '127.0.0.1', port: 0, cf: false, compatibilityDate: '2025-07-18', log: new Log(LogLevel.NONE) })
  try {
    const response = await worker.dispatchFetch('https://queue.example/verify')
    assert.equal(response.status, 200, await response.clone().text())
    assert.deepEqual(await response.json(), { verified: true, retries: true, fenced: true, drained: true })
    console.log('workers: the bounded queue contract executes in real workerd using a process-local fixture store.')
  } finally { await worker.dispose() }

  const concurrent = join(temporary, 'concurrent.sqlite')
  await completed(fixture('seed', concurrent, '16'))
  await Promise.all([completed(fixture('consume', concurrent, 'one')), completed(fixture('consume', concurrent, 'two'))])
  const result = await inspect(concurrent)
  assert.equal(result.integrity, 'ok'); assert.equal(result.jobs.length, 16)
  assert.ok(result.jobs.every((job) => job.state === 'succeeded'))
  assert.equal(result.effects.length, 16); assert.equal(result.attempts.length, 17)
  assert.equal(new Set(result.attempts.map((attempt) => attempt.consumer)).size, 2)
  assert.equal(result.jobs.filter((job) => job.attempts === 2).length, 1)
  console.log('SQLite: separate consumer processes claim distinct jobs, retry a handler failure, and persist one effect per job.')

  for (const [name, maxAttempts, expected] of [['recover', '3', 'succeeded'], ['exhaust', '1', 'failed']]) {
    const filename = join(temporary, `${name}.sqlite`)
    await completed(fixture('seed', filename, '1', maxAttempts)); await crash(filename)
    await completed(fixture('consume', filename, 'recovery'))
    const recovered = await inspect(filename)
    assert.equal(recovered.jobs[0].state, expected)
    assert.equal(recovered.jobs[0].attempts, expected === 'succeeded' ? 2 : 1)
    assert.equal(recovered.jobs[0].lastFailure, 'lease-expired')
    assert.equal(recovered.effects.length, expected === 'succeeded' ? 1 : 0)
    assert.equal(recovered.integrity, 'ok')
  }
  console.log('SQLite: SIGKILL after claim recovers on lease expiry; a crashed final attempt becomes terminal without another execution.')

  const slow = join(temporary, 'heartbeat.sqlite')
  await completed(fixture('seed', slow, '1'))
  await completed(fixture('slow', slow, 'slow'))
  const renewed = await inspect(slow)
  assert.equal(renewed.jobs[0].state, 'succeeded'); assert.equal(renewed.jobs[0].attempts, 1)
  console.log('SQLite: automatic heartbeats preserve one attempt through a handler longer than two original leases.')

  const filename = join(temporary, 'reports.sqlite')
  const producer = await host(filename, false)
  const response = await request(producer.url, '/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ numbers: [2, 4, 6] }) })
  assert.equal(response.status, 202); assert.equal(response.headers.get('Cache-Control'), 'no-store')
  const { job } = await response.json()
  assert.equal(job.state, 'pending'); assert.equal(response.headers.get('Location'), `/reports/${job.id}`)
  assert.ok(!('payload' in job) && !('leaseToken' in job))
  await stop(producer.instance)
  const consumer = await host(filename, true)
  const deadline = Date.now() + 5000
  while (true) {
    const status = await (await request(consumer.url, `/reports/${job.id}`)).json()
    if (status.job.state === 'succeeded') { assert.deepEqual(status.report, { count: 3, sum: 12, min: 2, max: 6 }); break }
    assert.ok(Date.now() < deadline, 'Report not processed after restart')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  await stop(consumer.instance)
  assert.ok(consumer.instance.records.some((value) => value.message === 'Application stopped'))
  const reopened = await host(filename, false)
  const persisted = await (await request(reopened.url, `/reports/${job.id}`)).json()
  assert.equal(persisted.job.state, 'succeeded'); assert.equal(persisted.report.sum, 12)
  await stop(reopened.instance)
  console.log('Reports HTTP: validated enqueue returns 202/status location, pending work survives restart, a lifecycle worker processes it, and results persist through another restart.')
} finally {
  await Promise.all(instances.map(stop))
  await rm(temporary, { recursive: true, force: true })
}
