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
const temporary = await mkdtemp(join(tmpdir(), 'longhorn-cache-'))
const instances = []

function launch(binary, args, environment = {}) {
  const child = spawn(binary, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'info', CACHE_TTL_MS: '2000',
    DATABASE_PATH: join(temporary, 'tasks.sqlite'), ...environment,
  } })
  let output = ''
  const records = []
  createInterface({ input: child.stdout }).on('line', (line) => {
    output += `${line}\n`
    try { records.push(JSON.parse(line)) } catch { /* Preserve diagnostics. */ }
  })
  child.stderr.on('data', (chunk) => { output += chunk })
  child.on('error', (error) => { output += `${error.stack ?? error}\n` })
  const ended = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })))
  const instance = { child, records, ended, output: () => output }
  instances.push(instance)
  return instance
}
async function completed(instance) {
  const timer = setTimeout(() => instance.child.kill('SIGKILL'), 15000)
  try {
    const { code, signal } = await instance.ended
    assert.equal(code, 0, `${signal ?? code}: ${instance.output()}`)
  } finally { clearTimeout(timer) }
}
async function stop(instance) {
  if (instance.child.exitCode !== null || instance.child.signalCode !== null) { await instance.ended; return }
  instance.child.kill('SIGTERM'); await completed(instance)
}
async function listening(instance) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const record = instance.records.find((record) => record.message === 'HTTP server listening')
    if (record) return record.fields.url
    if (!instance.child.pid || instance.child.exitCode !== null || instance.child.signalCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Tasks host did not start: ${instance.output()}`)
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
async function request(url, path, options) { return fetch(`${url}${path}`, { ...options, signal: AbortSignal.timeout(5000) }) }
async function summary(url) {
  const response = await request(url, '/summary')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  return (await response.json()).summary
}

try {
  for (const [runtime, binary, flags] of [
    ['node', process.execPath, []], ['bun', bun, []],
    ['deno', deno, ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual']],
  ]) {
    const instance = launch(binary, [...flags, join(root, 'scripts/fixtures/run-cache.mjs')])
    await completed(instance)
    assert.ok(instance.records.some((record) => record.runtime === runtime && record.verified), instance.output())
    console.log(`${runtime}: built cache verifies expiry, undefined hits, shared loading, copies, invalidation races, and draining.`)
  }
  const bundle = join(temporary, 'worker')
  await build({ entry: { worker: join(root, 'scripts/fixtures/cache-worker.mjs') }, outDir: bundle,
    bundle: true, splitting: false, platform: 'browser', target: 'es2022', format: ['esm'], silent: true,
  })
  const worker = new Miniflare({ modules: true, modulesRoot: bundle, scriptPath: join(bundle, 'worker.js'),
    host: '127.0.0.1', port: 0, cf: false, compatibilityDate: '2025-07-18', log: new Log(LogLevel.NONE) })
  try {
    const response = await worker.dispatchFetch('https://cache.example/verify')
    assert.equal(response.status, 200, await response.clone().text())
    assert.deepEqual(await response.json(), { verified: true, loads: 1, isolated: true, invalidated: true, drained: true })
    console.log('workers: the same cache contract executes in real workerd from a browser bundle.')
  } finally { await worker.dispose() }

  const a = launch(process.execPath, [join(root, 'examples/basic/dist/index.js')])
  const b = launch(process.execPath, [join(root, 'examples/basic/dist/index.js')])
  const one = await listening(a); const two = await listening(b)
  const cold = await Promise.all(Array.from({ length: 20 }, () => summary(one)))
  assert.ok(cold.every((value) => JSON.stringify(value) === JSON.stringify(cold[0])))
  assert.equal(cold[0].total, 0)
  const created = await request(one, '/tasks', json('POST', { title: 'cached summary test' }))
  assert.equal(created.status, 201)
  const task = (await created.json()).task
  assert.equal((await summary(one)).pending, 1)
  await request(one, `/tasks/${task.id}`, json('PATCH', { completed: true }))
  assert.equal((await summary(one)).completed, 1)
  const before = await summary(one)
  const external = await request(two, '/tasks', json('POST', { title: 'external writer' }))
  assert.equal(external.status, 201)
  assert.deepEqual(await summary(one), before)
  assert.equal((await (await request(one, '/tasks')).json()).tasks.length, 2)
  const deadline = Date.now() + 5000
  let refreshed
  do {
    refreshed = await summary(one)
    if (refreshed.total === 2) break
    assert.ok(Date.now() < deadline, 'External write did not become visible after TTL')
    await new Promise((resolve) => setTimeout(resolve, 50))
  } while (true)
  assert.equal(refreshed.completed, 1)
  await request(one, `/tasks/${task.id}`, { method: 'DELETE' })
  assert.equal((await summary(one)).total, 1)
  await stop(a); await stop(b)
  assert.equal(a.records.filter((record) => record.message === 'Task summary computed' && record.fields.total === 0).length, 1)
  const reopened = launch(process.execPath, [join(root, 'examples/basic/dist/index.js')])
  const url = await listening(reopened)
  assert.equal((await summary(url)).total, 1)
  await stop(reopened)
  assert.equal(reopened.records.filter((record) => record.message === 'Task summary computed').length, 1)
  assert.ok(reopened.records.some((record) => record.message === 'Application stopped'))
  console.log('Tasks: concurrent summaries share computation, local writes invalidate, external writes follow TTL, normal reads stay uncached, and restart/shutdown preserve source data.')
} finally {
  await Promise.all(instances.map(stop))
  await rm(temporary, { recursive: true, force: true })
}
