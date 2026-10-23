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
  const { tasks } = await request(fourth.url, '/tasks')
  assert.equal(tasks.length, 24)
  assert.equal(tasks.find((task) => task.id === original.id)?.completed, true)
  assert.ok(!tasks.some((task) => task.id === created[0].id))
  await stop(fourth)

  assert.equal((await readFile(filename)).subarray(0, 16).toString(), 'SQLite format 3\0')
  const database = await openSqlite({ filename })
  try {
    assert.equal((await database.execute('SELECT count(*) AS count FROM tasks')).rows[0].count, 24n)
    assert.equal((await database.execute('SELECT count(*) AS count FROM longhorn_migrations')).rows[0].count, 1n)
    assert.equal((await database.execute('PRAGMA integrity_check')).rows[0].integrity_check, 'ok')
  } finally { await database.close() }
  console.log('Persistence verified: process restarts, concurrent writers, updates, deletion, migrations, and SQLite integrity.')
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
