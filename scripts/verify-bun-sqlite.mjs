import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const bun = join(dirname(require.resolve('bun-runtime/package.json')), 'bin/bun.exe')
const directory = await mkdtemp(join(tmpdir(), 'longhorn native bun ')), children = []
function launch(args, env = {}) {
  const child = spawn(bun, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = ''; const records = []
  const ended = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) })
  ended.catch(() => {})
  createInterface({ input: child.stdout }).on('line', line => { output += line + '\n'; try { records.push(JSON.parse(line)) } catch {} })
  child.stderr.on('data', chunk => { output += chunk })
  const instance = { child, ended, records, output: () => output }
  children.push(instance); return instance
}
async function waitFor(instance, predicate, timeout = 10_000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const value = predicate(); if (value) return value
    assert.equal(instance.child.exitCode, null, instance.output())
    assert.equal(instance.child.signalCode, null, instance.output())
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Native Bun fixture timed out: ' + instance.output())
}
async function finish(instance, signal) {
  const timer = setTimeout(() => instance.child.kill('SIGKILL'), 15_000)
  if (signal) instance.child.kill(signal)
  else instance.child.stdin.end()
  try {
    const result = await instance.ended
    if (signal === 'SIGKILL') assert.equal(result.signal, 'SIGKILL', instance.output())
    else assert.deepEqual(result, { code: 0, signal: null }, instance.output())
    return instance.records
  } finally { clearTimeout(timer) }
}
async function request(instance, path, method = 'GET', body, status = 200) {
  const response = await fetch(instance.url + path, {
    method, signal: AbortSignal.timeout(10_000),
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const data = response.status === 204 ? null : await response.json()
  assert.equal(response.status, status, JSON.stringify(data)); return data
}
const filename = join(directory, 'tasks #1.sqlite')
async function start() {
  const instance = launch(['examples/bun-sqlite/dist/index.js'], { HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'info', DATABASE_PATH: filename, CACHE_TTL_MS: '0' })
  const ready = await waitFor(instance, () => instance.records.find(value => value.message === 'HTTP server listening'))
  instance.url = ready.fields.url; return instance
}
const processFixture = (mode, file) => launch(['scripts/fixtures/bun-sqlite-process.mjs', mode, file])
try {
  const tests = launch(['test', 'runtimes/bun/test/sqlite.test.mjs'])
  await finish(tests); console.log(tests.output().trim())
  const crashFile = join(directory, 'crash.sqlite')
  await finish(processFixture('init', crashFile))
  const before = processFixture('before', crashFile)
  await waitFor(before, () => before.records.find(value => value.phase === 'uncommitted'))
  await finish(before, 'SIGKILL')
  let state = await finish(processFixture('inspect', crashFile))
  assert.deepEqual(state[0], { labels: [], integrity: 'ok' })
  const after = processFixture('after', crashFile)
  await waitFor(after, () => after.records.find(value => value.phase === 'committed'))
  await finish(after, 'SIGKILL')
  state = await finish(processFixture('inspect', crashFile))
  assert.deepEqual(state[0], { labels: ['after'], integrity: 'ok' })
  const held = processFixture('hold', crashFile)
  await waitFor(held, () => held.records.find(value => value.phase === 'uncommitted'))
  const contender = await finish(processFixture('contend', crashFile))
  assert.deepEqual(contender[0], { code: 'storage', message: 'Bun SQLite operation failed: storage' })
  await finish(held)
  state = await finish(processFixture('inspect', crashFile))
  assert.deepEqual(state[0], { labels: ['after', 'hold'], integrity: 'ok' })

  const first = await start()
  await request(first, '/health')
  await request(first, '/tasks', 'POST', { title: '' }, 400)
  const original = (await request(first, '/tasks', 'POST', { title: 'Bun survives restart' }, 201)).task
  assert.equal((await request(first, '/summary')).summary.total, 1)
  assert.equal((await request(first, '/activity')).activity.created, 1)
  await finish(first, 'SIGTERM')
  const second = await start()
  assert.deepEqual((await request(second, '/tasks/' + original.id)).task, original)
  assert.equal((await request(second, '/activity')).activity.created, 0)
  await request(second, '/tasks/' + original.id, 'PATCH', { completed: true })
  const third = await start()
  const created = await Promise.all(Array.from({ length: 24 }, async (_, index) => (await request(index % 2 ? second : third, '/tasks', 'POST', { title: 'Concurrent ' + index }, 201)).task))
  assert.equal(new Set(created.map(task => task.id)).size, 24)
  await request(second, '/tasks/' + created[0].id, 'DELETE', undefined, 204)
  await finish(second, 'SIGTERM'); await finish(third, 'SIGINT')
  const fourth = await start(), tasks = (await request(fourth, '/tasks')).tasks
  assert.equal(tasks.length, 24)
  assert.equal(tasks.find(task => task.id === original.id).completed, true)
  assert.ok(!tasks.some(task => task.id === created[0].id))
  await finish(fourth, 'SIGTERM')
  assert.equal((await readFile(filename)).subarray(0, 16).toString(), 'SQLite format 3\0')
  console.log('Native Bun SQLite verified: SQL/value/lifetime contracts, unchanged queue/scheduler/replay stores, real lock failure without replay, SIGKILL rollback/durability, HTTP validation/CRUD, two-process writers and retained restart.')
} finally {
  for (const instance of children) if (instance.child.exitCode === null && instance.child.signalCode === null) instance.child.kill('SIGKILL')
  await Promise.allSettled(children.map(instance => instance.ended))
  await rm(directory, { recursive: true, force: true })
}
