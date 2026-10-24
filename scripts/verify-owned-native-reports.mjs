import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { openOwnedNativeReports } from '../examples/jobs/dist/owned-native-reports.js'
import { rustReportBinary } from './rust-reports-tools.mjs'
import { localReportTestEnvironment } from './local-report-test-environment.mjs'

const root = fileURLToPath(new URL('..', import.meta.url)), directory = await mkdtemp(join(tmpdir(), 'longhorn owned native '))
const children = [], descendants = new Set(), fixturePids = new Set(), filename = join(directory, 'retained reports.sqlite')
let occupied
function launch(entry, extra = {}) {
  const child = spawn(process.execPath, [join(root, entry)], { cwd: root, env: { ...process.env, ...localReportTestEnvironment,
    HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'info', WORKER_ENABLED: 'true', SCHEDULER_ENABLED: 'false', DATABASE_PATH: filename,
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '', OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: '', OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: '',
    REPORTS_NATIVE_BINARY: rustReportBinary, ...extra }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let output = ''; const records = []
  for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', line => { output += line + '\n'; try { records.push(JSON.parse(line)) } catch {} })
  child.on('error', () => { output += 'Owned native host failed to spawn\n' })
  child.on('message', message => { if (Number.isSafeInteger(message?.pid) && message.pid > 0) { if (message.action === 'opened') descendants.add(message.pid); else if (message.action === 'closed') descendants.delete(message.pid) } })
  const instance = { child, records, output: () => output, ended: new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal }))) }
  children.push(instance); return instance
}
async function waitFor(instance, action, timeout = 15_000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const value = await action(); if (value) return value
    if (instance && (instance.child.exitCode !== null || instance.child.signalCode !== null)) throw new Error(instance.output())
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Owned native condition timed out: ' + (instance?.output() ?? ''))
}
async function finish(instance, signal, expected = 0) {
  if (signal) instance.child.kill(signal)
  const timer = setTimeout(() => instance.child.kill('SIGKILL'), 20_000)
  try { assert.deepEqual(await instance.ended, { code: expected, signal: null }, instance.output()) }
  finally { clearTimeout(timer) }
}
const gone = pid => assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH')
async function host(entry = 'examples/jobs/dist/native-index.js', extra = {}) {
  const instance = launch(entry, extra)
  const ready = await waitFor(instance, () => instance.records.find(value => value.message === 'HTTP server listening'))
  const native = instance.records.find(value => value.message === 'Owned native reports ready')
  assert.ok(native); return Object.assign(instance, { url: ready.fields.url, nativePid: native.fields.pid, nativeUrl: native.fields.url })
}
const post = numbers => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ numbers }) })
async function enqueue(instance, numbers) { const response = await fetch(instance.url + '/reports', post(numbers)); assert.equal(response.status, 202); return (await response.json()).job }
async function report(instance, id) { const response = await fetch(instance.url + '/reports/' + id); assert.equal(response.status, 200); return response.json() }
async function fake(name, program) {
  const path = join(directory, name), quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
  await writeFile(path, '#!/bin/sh\nexec ' + quote(process.execPath) + ' -e ' + quote(program) + '\n'); await chmod(path, 0o700); return path
}
try {
  const resource = await openOwnedNativeReports({ executable: rustReportBinary })
  try { assert.equal(await resource.healthy(), true); assert.deepEqual(await resource.compute({ numbers: [2, 4] }, new AbortController().signal), { count: 2, sum: 6, min: 2, max: 4 }) }
  finally { await resource.close() }
  gone(resource.pid); assert.equal(await resource.healthy(), false)
  const badPidFile = join(directory, 'bad-health.pid')
  const bad = await fake('wrong health service', `const fs=require('node:fs'),http=require('node:http');fs.writeFileSync(${JSON.stringify(badPidFile)},String(process.pid));const server=http.createServer((q,s)=>{s.setHeader('Content-Type','application/json');s.end(JSON.stringify({protocol:'wrong',status:'ok'}))});process.on('SIGTERM',()=>server.close(()=>process.exit(0)));server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({message:'Native reports listening',protocol:'longhorn.reports.v1',url:'http://127.0.0.1:'+server.address().port})));`)
  await assert.rejects(openOwnedNativeReports({ executable: bad }), error => error.code === 'unavailable')
  const badPid = Number(await readFile(badPidFile, 'utf8')); fixturePids.add(badPid); gone(badPid); fixturePids.delete(badPid)
  console.log('Owned resource: real Rust startup/probe/compute and actual close verified; incompatible health tears down the acquired child before rejection.')

  let instance = await host()
  assert.equal((await fetch(instance.url + '/readyz')).status, 200)
  const first = await enqueue(instance, [3, -1, 9])
  const saved = await waitFor(instance, async () => { const value = await report(instance, first.id); return value.job.state === 'succeeded' ? value : false })
  assert.deepEqual(saved.report, { count: 3, sum: 11, min: -1, max: 9 })
  await finish(instance, 'SIGTERM'); gone(instance.nativePid)
  instance = await host()
  assert.deepEqual((await report(instance, first.id)).report, saved.report)
  process.kill(instance.nativePid, 'SIGKILL')
  await waitFor(instance, async () => (await fetch(instance.url + '/readyz')).status === 503)
  const pending = await enqueue(instance, [5, 10])
  await waitFor(instance, async () => { const value = await report(instance, pending.id); assert.equal(value.report, null); return value.job.state === 'pending' && value.job.attempts >= 1 })
  await finish(instance, 'SIGTERM', 1); gone(instance.nativePid)
  instance = await host()
  const recovered = await waitFor(instance, async () => { const value = await report(instance, pending.id); return value.job.state === 'succeeded' ? value : false })
  assert.deepEqual(recovered.report, { count: 2, sum: 15, min: 5, max: 10 })
  await finish(instance, 'SIGTERM'); gone(instance.nativePid)
  console.log('Owned jobs: async DI startup, actual native results, retained host restart, killed-child readiness/failure, durable retry and fresh-process recovery verified.')

  occupied = createServer((_request, response) => response.end('occupied'))
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve))
  const conflict = launch('examples/jobs/dist/native-index.js', { PORT: String(occupied.address().port) })
  await finish(conflict, undefined, 1)
  const acquired = conflict.records.find(value => value.message === 'Owned native reports ready')
  assert.ok(acquired); gone(acquired.fields.pid)
  await new Promise(resolve => occupied.close(resolve)); occupied = undefined
  const missing = launch('examples/jobs/dist/native-index.js', { REPORTS_NATIVE_BINARY: join(directory, 'missing-binary') })
  await finish(missing, undefined, 1); assert.ok(!missing.records.some(value => value.message === 'HTTP server listening'))

  const waitingPid = join(directory, 'waiting.pid')
  const waiting = await fake('silent startup service', `require('node:fs').writeFileSync(${JSON.stringify(waitingPid)},String(process.pid));process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`)
  const cancelled = launch('examples/jobs/dist/native-index.js', { REPORTS_NATIVE_BINARY: waiting })
  const pid = await waitFor(cancelled, async () => { try { return Number(await readFile(waitingPid, 'utf8')) } catch { return undefined } })
  fixturePids.add(pid); cancelled.child.kill('SIGTERM'); await finish(cancelled); gone(pid); fixturePids.delete(pid)
  assert.ok(!cancelled.records.some(value => value.message === 'HTTP server listening'))
  console.log('Startup rollback: occupied HTTP bind releases the ready Rust child; missing executable blocks readiness; cancellation joins an entered silent child before the host exits.')

  const launched = await host('scripts/serve-native-jobs.mjs')
  assert.equal((await fetch(launched.url + '/readyz')).status, 200)
  await finish(launched, 'SIGTERM'); gone(launched.nativePid)
  await waitFor(undefined, () => descendants.size === 0)
  console.log('Native jobs launcher: explicit executable selection, persistent host startup and forwarded shutdown release both host and native child.')
} finally {
  for (const instance of children) if (instance.child.exitCode === null && instance.child.signalCode === null) instance.child.kill('SIGKILL')
  for (const pid of [...descendants, ...fixturePids]) try { process.kill(pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  await Promise.allSettled(children.map(instance => instance.ended))
  if (occupied?.listening) await new Promise(resolve => { occupied.close(resolve); occupied.closeAllConnections() })
  await rm(directory, { recursive: true, force: true })
}
