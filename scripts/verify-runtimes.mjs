import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { Miniflare, Log, LogLevel } from 'miniflare'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const bun = join(dirname(require.resolve('bun-runtime/package.json')), 'bin/bun.exe')
const deno = join(dirname(require.resolve('deno-runtime/package.json')), process.platform === 'win32' ? 'deno.exe' : 'deno')
const denoFlags = ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual', '--allow-net=127.0.0.1', '--allow-env=HOST,PORT,LOG_LEVEL']
const processes = new Set()

function launch(binary, args) {
  const child = spawn(binary, args, {
    cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'info' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  processes.add(child)
  let output = ''
  const records = []
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    output += `${line}\n`
    try { records.push(JSON.parse(line)) } catch { /* Native diagnostics are retained in output. */ }
  })
  child.stderr.on('data', (chunk) => { output += chunk })
  child.on('error', (error) => { output += `${error.stack ?? error}\n` })
  return { child, records, output: () => output }
}

async function completed(instance) {
  const { child } = instance
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000)
  try {
    const [code, signal] = await once(child, 'close')
    processes.delete(child)
    assert.equal(code, 0, `${signal ?? code}: ${instance.output()}`)
  } finally { clearTimeout(timer) }
}

async function listening(instance) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const record = instance.records.find((record) => record.message === 'HTTP server listening')
    if (record) return record.fields.url
    if (!instance.child.pid || instance.child.exitCode !== null || instance.child.signalCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Listener did not start: ${instance.output()}`)
}

async function exercise(url, runtime) {
  assert.equal((await fetch(`${url}/livez`)).status, 200)
  assert.equal((await fetch(`${url}/readyz`)).status, 200)
  const profile = await fetch(`${url}/cached`)
  assert.equal(profile.status, 200)
  assert.equal(profile.headers.get('Cache-Control'), 'no-store')
  const cached = await profile.json()
  assert.equal(cached.runtime, runtime)
  assert.deepEqual(await (await fetch(`${url}/cached`)).json(), cached)
  assert.equal((await fetch(`${url}/cached/invalidate`, { method: 'POST' })).status, 204)
  let response = await fetch(`${url}/health`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok', runtime, ready: true })
  assert.ok(response.headers.get('X-Request-Id'))
  assert.ok(response.headers.get('traceparent'))
  assert.ok((await (await fetch(`${url}/metrics`)).text()).includes('longhorn_http_requests_total'))
  assert.ok((await (await fetch(`${url}/traces`)).json()).spans.some((span) => span.name === 'GET /health'))
  response = await fetch(`${url}/`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { runtime, greeting: runtime === 'workers' ? 'Hello from Workers' : 'Hello from LongHorn' })
  response = await fetch(`${url}/echo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":"  portable  "}',
  })
  assert.deepEqual(await response.json(), { message: 'portable', runtime, ready: true })
  const echoRequestId = response.headers.get('X-Request-Id')
  const activity = await fetch(`${url}/events`)
  assert.deepEqual(await activity.json(), { events: { echoes: 1, requestId: echoRequestId } })
  response = await fetch(`${url}/echo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":""}',
  })
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error, 'Validation failed')
  response = await fetch(`${url}/failure`)
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'Internal Server Error' })
}

try {
  for (const [runtime, binary, flags] of [['bun', bun, []], ['deno', deno, denoFlags]]) {
    const fixture = launch(binary, [...flags, join(root, 'scripts/fixtures/verify-native-runtime.mjs')])
    await completed(fixture)
    assert.ok(fixture.records.some((record) => record.runtime === runtime && record.verified), fixture.output())
    const example = launch(binary, [...flags, join(root, `examples/portable/dist/${runtime}.js`)])
    const url = await listening(example)
    await exercise(url, runtime)
    const ending = completed(example)
    example.child.kill('SIGTERM')
    await ending
    assert.ok(example.records.some((record) => record.message === 'Application stopped'), example.output())
    console.log(`${runtime}: native transport, lifecycle, config, DI, validation, logging, and host shutdown verified.`)
  }

  const workerLogs = []
  const worker = new Miniflare({
    modules: true, scriptPath: join(root, 'examples/portable/dist/worker.js'),
    compatibilityDate: '2025-07-18', host: '127.0.0.1', port: 0, cf: false,
    bindings: { GREETING: 'Hello from Workers' }, kvNamespaces: ['AUDIT'], log: new Log(LogLevel.NONE),
    handleRuntimeStdio(stdout, stderr) {
      for (const stream of [stdout, stderr]) {
        createInterface({ input: stream }).on('line', (line) => {
          try { workerLogs.push(JSON.parse(line)) } catch { /* Native non-JSON diagnostics are not application records. */ }
        })
      }
    },
  })
  try {
    const url = String(await worker.ready).replace(/\/$/, '')
    await exercise(url, 'workers')
    const greeting = await worker.dispatchFetch('https://worker.example/')
    assert.deepEqual(await greeting.json(), { runtime: 'workers', greeting: 'Hello from Workers' })
    const response = await worker.dispatchFetch('https://worker.example/background')
    const { queued } = await response.json()
    assert.equal(queued, response.headers.get('X-Request-Id'))
    const audit = await worker.getKVNamespace('AUDIT')
    const deadline = Date.now() + 3000
    while (await audit.get('last-request') !== queued) {
      assert.ok(Date.now() < deadline, 'waitUntil background work did not complete')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.ok(workerLogs.some((record) => record.message === 'HTTP request completed' && record.fields.requestId === queued))
    assert.ok(workerLogs.some((record) => record.message === 'HTTP request failed' && record.level === 'error'))
    console.log('workers: real workerd Fetch, bindings, validation, structured logs, request IDs, and waitUntil/KV verified.')
  } finally { await worker.dispose() }

  const localWorker = launch(process.execPath, [join(root, 'scripts/serve-worker.mjs')])
  const localUrl = await listening(localWorker)
  await exercise(localUrl, 'workers')
  const ending = completed(localWorker)
  localWorker.child.kill('SIGTERM')
  await ending
  assert.ok(localWorker.records.some((record) => record.message === 'Application stopped'), localWorker.output())
  console.log('workers-local: development host releases workerd and exits cleanly on shutdown.')
} finally {
  await Promise.all([...processes].map(async (child) => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'close')
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
    child.kill('SIGTERM')
    try { await exited } finally { clearTimeout(timer) }
  }))
}
