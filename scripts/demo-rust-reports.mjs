import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { rustReportBinary } from './rust-reports-tools.mjs'

const root = fileURLToPath(new URL('..', import.meta.url)), token = randomBytes(32).toString('hex')
let directory, native, jobs, stopping = false, closing
function launch(binary, args, env) {
  const child = spawn(binary, args, { cwd: root, env: { ...process.env, ...env }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }), records = []
  for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', line => {
    try { const record = JSON.parse(line); records.push(record); console.log(line.replaceAll(token, '[redacted]')) }
    catch { console.error('Owned demo child diagnostic') }
  })
  child.on('error', () => {})
  const notify = action => { if (process.connected && child.pid) process.send?.({ action, pid: child.pid }, () => {}) }
  notify('opened')
  return { child, records, ended: new Promise(resolve => child.once('close', (code, signal) => { notify('closed'); resolve({ code, signal }) })) }
}
async function waitFor(instance, action) {
  const until = Date.now() + 15_000
  while (!stopping && Date.now() < until) {
    const value = await action(); if (value) return value
    if (instance.child.exitCode !== null || instance.child.signalCode !== null) throw new Error('Owned demo child exited')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  if (!stopping) throw new Error('Owned demo startup timed out')
}
async function stop(instance) {
  if (!instance) return
  if (instance.child.exitCode === null && instance.child.signalCode === null) instance.child.kill('SIGTERM')
  let forced = false
  const timer = setTimeout(() => { forced = true; instance.child.kill('SIGKILL') }, 10_000)
  try { const result = await instance.ended; if (forced || result.code !== 0) throw new Error('Owned demo cleanup failed') }
  finally { clearTimeout(timer) }
}
async function boot() {
  directory = await mkdtemp(join(tmpdir(), 'longhorn rust reports demo '))
  if (stopping) return
  native = launch(rustReportBinary, [], { LONGHORN_NATIVE_TOKEN: token, LONGHORN_NATIVE_PORT: '0', LONGHORN_NATIVE_HOST: '127.0.0.1' })
  const service = await waitFor(native, () => native.records.find(value => value.message === 'Native reports listening'))
  if (!service || stopping) return
  jobs = launch(process.execPath, ['examples/jobs/dist/index.js'], { HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'info', DATABASE_PATH: join(directory, 'reports.sqlite'),
    WORKER_ENABLED: 'true', SCHEDULER_ENABLED: 'false', REPORTS_NATIVE_URL: service.url + '/', REPORTS_NATIVE_TOKEN: token, REPORTS_NATIVE_ALLOW_INSECURE_LOOPBACK: 'true',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '', OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: '', OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: '' })
  const ready = await waitFor(jobs, () => jobs.records.find(value => value.message === 'HTTP server listening'))
  if (!ready || stopping) return
  const response = await fetch(ready.fields.url + '/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"numbers":[3,-1,9]}', signal: AbortSignal.timeout(5000) })
  if (response.status !== 202) throw new Error('Demo report was not accepted')
  const { job } = await response.json()
  const result = await waitFor(jobs, async () => { const response = await fetch(ready.fields.url + '/reports/' + job.id, { signal: AbortSignal.timeout(5000) }); const value = await response.json(); return value.job?.state === 'succeeded' ? value : undefined })
  if (result) {
    const status = await fetch(service.url + '/status', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000) })
    const nativeStatus = await status.json()
    if (status.status !== 200 || BigInt(nativeStatus.completed) < 1n) throw new Error('Native computation was not observed')
    console.log(JSON.stringify({ message: 'Rust report demo ready', url: ready.fields.url, reportUrl: ready.fields.url + '/reports/' + job.id, report: result.report, nativeCompleted: nativeStatus.completed, temporaryStorage: directory }))
  }
}
const starting = boot()
function shutdown(code = 0) {
  stopping = true; if (code) process.exitCode = code
  return closing ??= (async () => {
    await starting.catch(() => {})
    const errors = []
    for (const resource of [jobs, native]) try { await stop(resource) } catch (error) { errors.push(error) }
    if (directory) await rm(directory, { recursive: true, force: true })
    if (errors.length) process.exitCode = 1
    console.log(JSON.stringify({ message: 'Rust report demo stopped' }))
  })()
}
process.on('SIGINT', () => { void shutdown() }); process.on('SIGTERM', () => { void shutdown() })
starting.catch(() => { console.error('Rust report demo startup failed'); void shutdown(1) })
