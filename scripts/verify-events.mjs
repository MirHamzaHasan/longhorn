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
const temporary = await mkdtemp(join(tmpdir(), 'longhorn-events-'))
const instances = []

function launch(binary, args, environment = {}) {
  const child = spawn(binary, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'info', DATABASE_PATH: join(temporary, 'tasks.sqlite'), ...environment,
  } })
  let output = ''
  const records = []
  createInterface({ input: child.stdout }).on('line', (line) => {
    output += `${line}\n`
    try { records.push(JSON.parse(line)) } catch { /* Retain native diagnostics. */ }
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
  instance.child.kill('SIGTERM')
  await completed(instance)
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

try {
  for (const [runtime, binary, flags] of [
    ['node', process.execPath, []], ['bun', bun, []],
    ['deno', deno, ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual']],
  ]) {
    const instance = launch(binary, [...flags, join(root, 'scripts/fixtures/run-events.mjs')])
    await completed(instance)
    assert.ok(instance.records.some((record) => record.runtime === runtime && record.verified), instance.output())
    console.log(`${runtime}: built events package verified for ordering, once/abort ownership, nested drain, failures, correlation, and close.`)
  }
  const bundle = join(temporary, 'worker')
  await build({ entry: { worker: join(root, 'scripts/fixtures/events-worker.mjs') }, outDir: bundle,
    bundle: true, splitting: false, platform: 'browser', target: 'es2022', format: ['esm'], silent: true,
  })
  const worker = new Miniflare({ modules: true, modulesRoot: bundle, scriptPath: join(bundle, 'worker.js'),
    host: '127.0.0.1', port: 0, cf: false, compatibilityDate: '2025-07-18', log: new Log(LogLevel.NONE) })
  try {
    const response = await worker.dispatchFetch('https://events.example/verify')
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { verified: true, onceCalls: 1, observed: 2, childCalls: 1, failures: 1 })
    console.log('workers: the same events contract runs in real workerd from a browser bundle.')
  } finally { await worker.dispose() }

  const first = launch(process.execPath, [join(root, 'examples/basic/dist/index.js')])
  const url = await listening(first)
  const request = (path, options) => fetch(`${url}${path}`, { ...options, signal: AbortSignal.timeout(5000) })
  const activity = async () => (await (await request('/activity')).json()).activity
  assert.deepEqual(await activity(), { created: 0, updated: 0, deleted: 0 })
  const title = 'a task title that must not be logged'
  const created = await request('/tasks', json('POST', { title }))
  assert.equal(created.status, 201)
  const task = (await created.json()).task
  const createdActivity = await activity()
  assert.equal(createdActivity.created, 1)
  assert.equal(createdActivity.latest.requestId, created.headers.get('X-Request-Id'))
  assert.equal(createdActivity.latest.taskId, task.id)
  assert.ok(first.records.some((record) => record.message === 'Task event observed'
    && record.fields.eventId === createdActivity.latest.eventId && record.fields.requestId === createdActivity.latest.requestId))
  for (let count = 0; count < 2; count++) assert.equal((await request(`/tasks/${task.id}`, json('PATCH', { completed: true }))).status, 200)
  assert.equal((await activity()).updated, 2)
  const deleted = await request(`/tasks/${task.id}`, { method: 'DELETE' })
  assert.equal(deleted.status, 204)
  const before = await activity()
  assert.equal(before.deleted, 1)
  assert.equal(before.latest.requestId, deleted.headers.get('X-Request-Id'))
  assert.equal((await request(`/tasks/${task.id}`, { method: 'DELETE' })).status, 404)
  assert.equal((await request('/tasks', json('POST', { title: '' }))).status, 400)
  assert.deepEqual(await activity(), before)
  const persistent = await request('/tasks', json('POST', { title }))
  const saved = (await persistent.json()).task
  await stop(first)
  assert.ok(first.records.some((record) => record.message === 'Application stopped'))
  const second = launch(process.execPath, [join(root, 'examples/basic/dist/index.js')])
  const reopened = await listening(second)
  assert.deepEqual(await (await fetch(`${reopened}/activity`)).json(), { activity: { created: 0, updated: 0, deleted: 0 } })
  assert.deepEqual(await (await fetch(`${reopened}/tasks`)).json(), { tasks: [saved] })
  await stop(second)
  for (const instance of [first, second]) assert.ok(!instance.output().includes(title), 'Task payload entered process logs')
  console.log('Tasks: committed CRUD emits awaited observations, correlates request IDs, skips failed/missing writes, drains on shutdown, and resets process-local activity on restart while tasks persist.')
} finally {
  await Promise.all(instances.map(stop))
  await rm(temporary, { recursive: true, force: true })
}
