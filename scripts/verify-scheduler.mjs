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
const temporary = await mkdtemp(join(tmpdir(), 'longhorn-scheduler-'))
const instances = []
function launch(binary, args, environment = {}) {
  const child = spawn(binary, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env: {
    ...process.env, HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'info',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '',OTEL_EXPORTER_OTLP_TRACES_HEADERS: '',OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: '10000',OTEL_SERVICE_NAME: 'longhorn-test',OTEL_SERVICE_VERSION: '',...environment,
  } })
  let output = ''; const records = []
  createInterface({ input: child.stdout }).on('line', (line) => {
    output += `${line}\n`; try { records.push(JSON.parse(line)) } catch { /* Preserve diagnostics. */ }
  })
  child.stderr.on('data', (chunk) => { output += chunk })
  child.on('error', (error) => { output += `${error.stack ?? error}\n` })
  const ended = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })))
  const instance = { child, records, ended, output: () => output }; instances.push(instance); return instance
}
async function completed(instance, killed = false) {
  const timeout = setTimeout(() => instance.child.kill('SIGKILL'), 20000)
  try {
    const result = await instance.ended
    if (killed) assert.equal(result.signal, 'SIGKILL', instance.output())
    else assert.equal(result.code, 0, instance.output())
    return instance.records
  } finally { clearTimeout(timeout) }
}
async function record(instance, predicate) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const result = instance.records.find(predicate)
    if (result) return result
    if (instance.child.exitCode !== null || instance.child.signalCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Child record missing: ${instance.output()}`)
}
async function stop(instance) { instance.child.kill('SIGTERM'); await completed(instance) }
async function dispose(instance) {
  if (instance.child.exitCode === null && instance.child.signalCode === null) instance.child.kill('SIGKILL')
  await instance.ended
}
const fixture = (mode, filename, argument) => launch(process.execPath, [join(root, 'scripts/fixtures/scheduler-process.mjs'), mode, filename, ...(argument === undefined ? [] : [argument])])
const inspect = async (filename) => (await completed(fixture('inspect', filename)))[0]
const request = (url, path, options) => fetch(`${url}${path}`, { ...options, signal: AbortSignal.timeout(5000) })
const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
async function host(filename, enabled) {
  const instance = launch(process.execPath, [join(root, 'examples/jobs/dist/index.js')], {
    DATABASE_PATH: filename, WORKER_ENABLED: String(enabled), SCHEDULER_ENABLED: String(enabled),
  })
  return { instance, url: (await record(instance, (value) => value.message === 'HTTP server listening')).fields.url }
}
try {
  for (const [runtime, binary, flags] of [
    ['node', process.execPath, []], ['bun', bun, []], ['deno', deno, ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual']],
  ]) {
    const records = await completed(launch(binary, [...flags, join(root, 'scripts/fixtures/run-scheduler.mjs')]))
    assert.ok(records.some((value) => value.runtime === runtime && value.verified))
    console.log(`${runtime}: built scheduler verifies shared ticks, missed-run policies, immutable IDs, cancellation, UTC cron and drain.`)
  }
  const bundle = join(temporary, 'worker')
  await build({ entry: { worker: join(root, 'scripts/fixtures/scheduler-worker.mjs') }, outDir: bundle,
    bundle: true, splitting: false, platform: 'browser', target: 'es2022', format: ['esm'], silent: true })
  const worker = new Miniflare({ modules: true, modulesRoot: bundle, scriptPath: join(bundle, 'worker.js'),
    host: '127.0.0.1', port: 0, cf: false, compatibilityDate: '2025-07-18', log: new Log(LogLevel.NONE) })
  try {
    const response = await worker.dispatchFetch('https://scheduler.example/verify')
    assert.equal(response.status, 200, await response.clone().text())
    assert.deepEqual(await response.json(), { verified: true, policies: true, shared: true, cron: true, drained: true })
    console.log('workers: bounded scheduling runs in actual workerd with an explicitly transient paired memory backend.')
  } finally { await worker.dispose() }

  const concurrent = join(temporary, 'concurrent.sqlite')
  await completed(fixture('seed', concurrent))
  const one = fixture('dispatch', concurrent, 'one'), two = fixture('dispatch', concurrent, 'two')
  await Promise.all([record(one, (value) => value.ready), record(two, (value) => value.ready)])
  one.child.stdin.end('go\n'); two.child.stdin.end('go\n')
  const records = (await Promise.all([completed(one), completed(two)])).flat()
  const dispatched = records.filter((row) => row.dispatched?.length)
  assert.equal(new Set(dispatched.map((row) => row.dispatcher)).size, 2)
  const ids = dispatched.flatMap((row) => row.dispatched.map((item) => item.jobId))
  assert.equal(ids.length, 20); assert.equal(new Set(ids).size, 20)
  const result = await inspect(concurrent)
  assert.equal(result.integrity, 'ok'); assert.equal(result.jobs.length, 20)
  assert.equal(result.schedule.dispatchCount, 20); assert.equal(result.schedule.nextAt, 2100)
  const ensured = (await completed(fixture('seed', concurrent)))[0].schedule
  assert.equal(ensured.dispatchCount, 20); assert.equal(ensured.nextAt, 2100)
  await completed(fixture('cancel', concurrent)); await completed(fixture('tick', concurrent, '5000'))
  const cancelled = await inspect(concurrent)
  assert.equal(cancelled.schedule.state, 'cancelled'); assert.equal(cancelled.jobs.length, 20)
  console.log('SQLite: two dispatcher processes enqueue each occurrence once; restart registration preserves cursors, and cancellation retains existing jobs.')

  const atomic = join(temporary, 'atomic.sqlite')
  await completed(fixture('seed', atomic))
  const crashed = fixture('crash', atomic)
  await record(crashed, (value) => value.transactionPaused)
  crashed.child.kill('SIGKILL'); await completed(crashed, true)
  const rolledBack = await inspect(atomic)
  assert.equal(rolledBack.integrity, 'ok'); assert.equal(rolledBack.jobs.length, 0)
  assert.equal(rolledBack.schedule.dispatchCount, 0); assert.equal(rolledBack.schedule.nextAt, 100)
  await completed(fixture('tick', atomic, '2000'))
  const recovered = await inspect(atomic)
  assert.equal(recovered.jobs.length, 20); assert.equal(recovered.schedule.dispatchCount, 20)
  assert.equal(new Set(recovered.jobs.map((job) => job.id)).size, 20)
  console.log('SQLite: SIGKILL after queue insertion but before cursor update rolls back both writes; recovery dispatches the intact backlog without duplicates.')

  const filename = join(temporary, 'reports.sqlite')
  const producer = await host(filename, false)
  const body = { id: 'restart-report', numbers: [3, 7], schedule: { kind: 'interval', intervalMs: 60_000, startAt: Date.now() - 300_000 } }
  const registered = await request(producer.url, '/report-schedules', post(body))
  assert.equal(registered.status, 200); assert.equal(registered.headers.get('Location'), '/report-schedules/restart-report')
  const initial = (await registered.json()).schedule
  assert.equal(initial.dispatchCount, 0); assert.ok(!('payload' in initial))
  assert.deepEqual((await (await request(producer.url, '/report-schedules', post(body))).json()).schedule, initial)
  assert.equal((await request(producer.url, '/report-schedules', post({ ...body, numbers: [99] }))).status, 409)
  await stop(producer.instance)
  const consumer = await host(filename, true)
  const deadline = Date.now() + 6000
  let dispatchedSchedule
  while (true) {
    const { schedule } = await (await request(consumer.url, '/report-schedules/restart-report')).json()
    if (schedule.lastJobId) {
      const status = await (await request(consumer.url, `/reports/${schedule.lastJobId}`)).json()
      if (status.job.state === 'succeeded') { assert.equal(status.report.sum, 10); dispatchedSchedule = schedule; break }
    }
    assert.ok(Date.now() < deadline, 'Scheduled report did not run after restart')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(dispatchedSchedule.dispatchCount, 1, 'Missed intervals should coalesce')
  assert.equal((await request(consumer.url, '/report-schedules/restart-report', { method: 'DELETE' })).status, 204)
  await stop(consumer.instance)
  const reopened = await host(filename, true)
  const status = (await (await request(reopened.url, '/report-schedules/restart-report')).json()).schedule
  assert.equal(status.state, 'cancelled'); assert.equal(status.dispatchCount, 1)
  assert.equal((await (await request(reopened.url, `/reports/${dispatchedSchedule.lastJobId}`)).json()).report.sum, 10)
  await stop(reopened.instance)
  assert.ok(reopened.instance.records.some((record) => record.message === 'Application stopped'))
  console.log('Reports HTTP: schedules survive disabled-host restart, coalesce downtime, execute through workers, reject changed definitions, and remain cancelled after another restart.')
} finally {
  await Promise.all(instances.map(dispose))
  await rm(temporary, { recursive: true, force: true })
}
