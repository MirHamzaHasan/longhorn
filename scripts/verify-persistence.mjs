import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { openSqlite } from '../runtimes/node/dist/sqlite.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'longhorn persistence '))
const filename = join(directory, 'nested data', 'tasks #1.sqlite')
const processes = new Set()

async function start() {
  const child = spawn(process.execPath, [join(root, 'examples/basic/dist/index.js')], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'info', DATABASE_PATH: filename },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  processes.add(child)
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error(`Startup timed out: ${output}`)), 8000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Exited before startup (${code}): ${output}`)) })
    child.stderr.on('data', (chunk) => { output += chunk })
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      output += `${line}\n`
      let record
      try { record = JSON.parse(line) } catch { return }
      if (record.message === 'HTTP server listening') {
        clearTimeout(timer)
        resolve({ child, url: record.fields.url })
      }
    })
  })
}

async function stop(instance) {
  const { child } = instance
  assert.equal(child.exitCode, null, 'Application exited before shutdown was requested')
  assert.equal(child.signalCode, null, 'Application was terminated before shutdown was requested')
  const exited = once(child, 'exit')
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
  child.kill('SIGTERM')
  try {
    const [code, signal] = await exited
    assert.equal(code, 0, `Shutdown failed: ${signal ?? code}`)
    processes.delete(child)
  } finally { clearTimeout(timer) }
}

async function request(url, path, method = 'GET', body) {
  const response = await fetch(`${url}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8000),
  })
  const data = response.status === 204 ? null : await response.json()
  assert.ok(response.ok, `HTTP ${response.status}: ${JSON.stringify(data)}`)
  return data
}

try {
  const first = await start()
  const original = (await request(first.url, '/tasks', 'POST', { title: 'Survive a process restart' })).task
  await stop(first)

  const second = await start()
  assert.deepEqual((await request(second.url, `/tasks/${original.id}`)).task, original)
  await request(second.url, `/tasks/${original.id}`, 'PATCH', { completed: true })
  const third = await start()
  const created = await Promise.all(Array.from({ length: 24 }, async (_, index) => {
    const { url } = index % 2 ? second : third
    return (await request(url, '/tasks', 'POST', { title: `Concurrent ${index}` })).task
  }))
  assert.equal(new Set(created.map((task) => task.id)).size, 24)
  assert.ok(created.every((task) => task.id !== original.id))
  await request(second.url, `/tasks/${created[0].id}`, 'DELETE')
  await stop(second)
  await stop(third)

  const fourth = await start()
  const { tasks } = await request(fourth.url, '/tasks?limit=100')
  assert.equal(tasks.length, 24)
  assert.equal(tasks.find((task) => task.id === original.id)?.completed, true)
  assert.ok(!tasks.some((task) => task.id === created[0].id))
  await stop(fourth)

  assert.equal((await readFile(filename)).subarray(0, 16).toString(), 'SQLite format 3\0')
  const database = await openSqlite({ filename })
  try {
    assert.equal((await database.execute('SELECT count(*) AS count FROM tasks')).rows[0].count, 24n)
    assert.equal((await database.execute('SELECT count(*) AS count FROM longhorn_migrations')).rows[0].count, 2n)
    assert.equal((await database.execute('PRAGMA integrity_check')).rows[0].integrity_check, 'ok')
    // Exceed Bun's default native result-row limit without relying on oversized SELECTs.
    await database.transaction(async tx => {
      for (let index = 0; index < 1005; index++) await tx.execute({
        sql: 'INSERT INTO tasks(title,completed) VALUES(?,?)', args: ['Large collection ' + index, index % 3 === 0],
      })
    })
    const plan = await database.execute({ sql: 'EXPLAIN QUERY PLAN SELECT id FROM tasks WHERE completed=? AND id>? ORDER BY id LIMIT ?', args: [true, 1n, 101] })
    assert.ok(plan.rows.some(row => String(row.detail).includes('tasks_completed_id')))
  } finally { await database.close() }
  const large = await start()
  const initialPage = await request(large.url, '/tasks')
  assert.equal(initialPage.tasks.length, 20)
  assert.equal(initialPage.nextCursor, initialPage.tasks.at(-1).id)
  const summary = (await request(large.url, '/summary')).summary
  assert.equal(summary.total, 1029); assert.equal(summary.completed, 336); assert.equal(summary.pending, 693)
  async function collect(completed) {
    const ids = []; let after
    do {
      const page = await request(large.url, '/tasks?limit=100' + (after ? '&after=' + after : '') + (completed === undefined ? '' : '&completed=' + completed))
      assert.ok(page.tasks.length <= 100)
      assert.ok(page.tasks.every(task => completed === undefined || task.completed === completed))
      for (const task of page.tasks) { if (ids.length) assert.ok(BigInt(task.id) > BigInt(ids.at(-1))); ids.push(task.id) }
      assert.ok(ids.length <= 2000, 'Cursor traversal must terminate')
      if (page.nextCursor !== null) { assert.ok(page.tasks.length > 0); assert.equal(page.nextCursor, page.tasks.at(-1).id) }
      after = page.nextCursor
    } while (after !== null)
    return ids
  }
  const all = await collect(), completed = await collect(true), pending = await collect(false)
  assert.equal(all.length, 1029); assert.equal(new Set(all).size, 1029)
  assert.equal(completed.length, 336); assert.equal(pending.length, 693)
  assert.deepEqual(await request(large.url, '/tasks?after=9223372036854775807'), { tasks: [], nextCursor: null })
  const boundary = initialPage.tasks.at(-1)
  await request(large.url, '/tasks/' + boundary.id, 'DELETE')
  const added = (await request(large.url, '/tasks', 'POST', { title: 'Created between cursor pages' })).task
  const later = await request(large.url, '/tasks?limit=100&after=' + boundary.id)
  assert.ok(later.tasks.every(task => BigInt(task.id) > BigInt(boundary.id)))
  const finalIds = await collect()
  assert.equal(finalIds.length, 1029); assert.ok(finalIds.includes(added.id)); assert.ok(!finalIds.includes(boundary.id))
  const finalSummary = (await request(large.url, '/summary')).summary
  assert.equal(finalSummary.total, 1029); assert.equal(finalSummary.completed, 336 - Number(boundary.completed))
  await stop(large)
  console.log('Persistence verified: restarts, concurrent writers, checked upgrade history/integrity, 1029-row native cursor traversal, exact filters, indexed range plan, aggregate summaries and live cursor-boundary deletion/insertion.')
} finally {
  await Promise.all([...processes].map(async (child) => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.kill('SIGTERM')
    try { await exited } finally { clearTimeout(timer) }
  }))
  await rm(directory, { recursive: true, force: true })
}
