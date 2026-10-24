import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const deno = join(dirname(require.resolve('deno-runtime/package.json')), process.platform === 'win32' ? 'deno.exe' : 'deno')
const bun = join(dirname(require.resolve('bun-runtime/package.json')), 'bin/bun.exe')
const directory = await mkdtemp(join(tmpdir(), 'longhorn native deno ')), children = []
const deniedDirectory = await mkdtemp(join(tmpdir(), 'longhorn denied deno '))
const dataPermissions = ['--allow-read=' + directory, '--allow-write=' + directory]
const hostPermissions = [...dataPermissions, '--allow-net=127.0.0.1', '--allow-env=APP_NAME,HOST,PORT,LOG_LEVEL,DATABASE_PATH,CACHE_TTL_MS']
function launch(args, env = {}, permissions = dataPermissions) {
  return spawnTracked(deno, [args[0], '--no-prompt', '--no-lock', '--node-modules-dir=manual', ...permissions, ...args.slice(1)], env)
}
function spawnTracked(executable, args, env = {}) {
  const child = spawn(executable, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
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
  throw new Error('Native Deno fixture timed out: ' + instance.output())
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
  const instance = launch(['run', 'examples/deno-sqlite/dist/index.js'], { HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'info', DATABASE_PATH: filename, CACHE_TTL_MS: '0' }, hostPermissions)
  const ready = await waitFor(instance, () => instance.records.find(value => value.message === 'HTTP server listening'))
  instance.url = ready.fields.url; return instance
}
const processFixture = (mode, file) => launch(['run', 'scripts/fixtures/deno-sqlite-process.mjs', mode, file])
try {
  const tests = launch(['test', '--no-check', 'runtimes/deno/test/sqlite.test.mjs'], { TMPDIR: directory, TMP: directory, TEMP: directory }, ['--allow-read', '--allow-write', '--allow-env=TMPDIR,TMP,TEMP'])
  await finish(tests); console.log(tests.output().trim())
  const permissionsFixture = 'scripts/fixtures/deno-sqlite-permissions.mjs'
  await finish(launch(['run', permissionsFixture, 'memory'], {}, []))
  for (const permission of ['--allow-read=', '--allow-write=']) {
    const denied = join(directory, 'no-' + (permission.includes('read') ? 'write' : 'read') + '.sqlite')
    await finish(launch(['run', permissionsFixture, 'open', denied], {}, [permission + directory]))
    await assert.rejects(access(denied), { code: 'ENOENT' })
  }
  const denied = join(deniedDirectory, 'forbidden.sqlite')
  await finish(launch(['run', permissionsFixture, 'attach', join(directory, 'allowed.sqlite'), denied]))
  await assert.rejects(access(denied), { code: 'ENOENT' })
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
  assert.deepEqual(contender[0], { code: 'storage', message: 'Deno SQLite operation failed: storage' })
  await finish(held)
  state = await finish(processFixture('inspect', crashFile))
  assert.deepEqual(state[0], { labels: ['after', 'hold'], integrity: 'ok' })

  const first = await start()
  await request(first, '/health')
  await request(first, '/tasks', 'POST', { title: '' }, 400)
  const original = (await request(first, '/tasks', 'POST', { title: 'Deno survives restart' }, 201)).task
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
  const fourth = await start(), tasks = (await request(fourth, '/tasks?limit=100')).tasks
  assert.equal(tasks.length, 24)
  assert.equal(tasks.find(task => task.id === original.id).completed, true)
  assert.ok(!tasks.some(task => task.id === created[0].id))
  for (let offset = 0; offset < 1005; offset += 24) {
    await Promise.all(Array.from({ length: Math.min(24, 1005 - offset) }, (_, index) => request(fourth, '/tasks', 'POST', { title: 'Bounded page ' + (offset + index) }, 201)))
  }
  let cursor, seen = []
  do {
    const page = await request(fourth, '/tasks?limit=100' + (cursor ? '&after=' + cursor : ''))
    assert.ok(page.tasks.length <= 100); seen.push(...page.tasks); cursor = page.nextCursor
  } while (cursor !== null)
  assert.equal(seen.length, 1029); assert.equal(new Set(seen.map(task => task.id)).size, 1029)
  const completed = await request(fourth, '/tasks?completed=true')
  assert.deepEqual(completed.tasks, [{ ...original, completed: true }]); assert.equal(completed.nextCursor, null)
  const summary = (await request(fourth, '/summary')).summary
  assert.deepEqual({ total: summary.total, completed: summary.completed, pending: summary.pending }, { total: 1029, completed: 1, pending: 1028 })
  await request(fourth, '/tasks?limit=101', 'GET', undefined, 400)
  await request(fourth, '/tasks?after=01', 'GET', undefined, 400)
  await finish(fourth, 'SIGTERM')
  await finish(processFixture('wide-task', filename))
  const fifth = await start()
  const wide = await request(fifth, '/tasks?after=9223372036854775806')
  assert.deepEqual(wide, { tasks: [{ id: '9223372036854775807', title: 'Wide int64 cursor', completed: false }], nextCursor: null })
  await finish(fifth, 'SIGTERM')
  const nodePeer = await finish(spawnTracked(process.execPath, ['scripts/fixtures/sqlite-runtime-peer.mjs', 'node', filename]))
  assert.deepEqual(nodePeer[0], { count: '1030', maximum: '9223372036854775807', previous: original.title })
  const bunPeer = await finish(spawnTracked(bun, ['scripts/fixtures/sqlite-runtime-peer.mjs', 'bun', filename]))
  assert.deepEqual(bunPeer[0], { count: '1030', maximum: '9223372036854775807', previous: 'node native peer' })
  const sixth = await start()
  assert.equal((await request(sixth, '/tasks/' + original.id)).task.title, 'bun native peer')
  assert.equal((await request(sixth, '/summary')).summary.total, 1030)
  await finish(sixth, 'SIGTERM')
  assert.equal((await readFile(filename)).subarray(0, 16).toString(), 'SQLite format 3\0')
  console.log('Native Deno SQLite verified: exact bindings/values, callback ownership, unchanged queue/scheduler/replay stores, read/write/ATTACH denial, real lock failure without replay, SIGKILL rollback/durability, native HTTP/concurrent writers, 1029-task bounded traversal/counts and retained int64 restart.')
  console.log('Native file interoperability: Node libSQL and Bun SQLite read the same 1030 retained tasks/int64 ID and commit updates subsequently served by Deno.')
} finally {
  for (const instance of children) if (instance.child.exitCode === null && instance.child.signalCode === null) instance.child.kill('SIGKILL')
  await Promise.allSettled(children.map(instance => instance.ended))
  await rm(directory, { recursive: true, force: true })
  await rm(deniedDirectory, { recursive: true, force: true })
}
