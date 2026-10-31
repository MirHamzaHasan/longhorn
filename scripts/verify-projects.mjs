import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const root = fileURLToPath(new URL('..', import.meta.url))
const cli = join(root, 'cli/dist/bin.js')
const creator = join(root, 'create-longhorn/dist/bin.js')
const temporary = await mkdtemp(join(tmpdir(), 'longhorn-projects-'))
const instances = new Set()

function launch(binary, args, cwd, detached = false, environment = {}) {
  const child = spawn(binary, args, {
    cwd, detached: detached && process.platform !== 'win32',
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', GREETING: 'Generated project', LOG_LEVEL: 'info', ...environment },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const records = []
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    output += `${line}\n`
    try { records.push(JSON.parse(line)) } catch { /* Keep tool diagnostics in output. */ }
  })
  child.stderr.on('data', (chunk) => { output += chunk })
  // Observe completion immediately so fast failures cannot beat a later waiter.
  const ended = new Promise((resolve) => {
    child.once('error', (error) => { output += `${error.stack ?? error}\n` })
    child.once('close', (code, signal) => { instances.delete(instance); resolve({ code, signal }) })
  })
  const instance = { child, records, ended, output: () => output, detached }
  instances.add(instance)
  return instance
}

function signal(instance, value) {
  if (instance.child.exitCode !== null || instance.child.signalCode !== null) return
  if (instance.detached && process.platform !== 'win32') process.kill(-instance.child.pid, value)
  else instance.child.kill(value)
}

async function stop(instance) {
  // pnpm and native watch tools can create their own process groups. Retain only
  // groups in this test-owned subtree, so a failed cleanup can be bounded without
  // leaving an orphan holding the captured pipes open.
  const groups = new Set()
  if (process.platform !== 'win32' && instance.child.exitCode === null && instance.child.signalCode === null) {
    const { stdout } = await promisify(execFile)('ps', ['-axo', 'pid=,ppid=,pgid='])
    const rows = stdout.trim().split('\n').map((row) => row.trim().split(/\s+/).map(Number))
    const owned = new Set([instance.child.pid])
    let previous = 0
    while (previous !== owned.size) {
      previous = owned.size
      for (const [pid, parent] of rows) if (owned.has(parent)) owned.add(pid)
    }
    for (const [pid, , group] of rows) {
      if (owned.has(pid) && rows.filter((row) => row[2] === group).every((row) => owned.has(row[0]))) groups.add(group)
    }
  }
  signal(instance, 'SIGTERM')
  let forced = false
  const timeout = setTimeout(() => {
    forced = true
    if (groups.size) {
      for (const group of groups) {
        try { process.kill(-group, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
      }
    }
    signal(instance, 'SIGKILL')
  }, 6000)
  try {
    await instance.ended
    assert.ok(!forced, `Server or watcher did not exit after graceful shutdown:\n${instance.output()}`)
  } finally { clearTimeout(timeout) }
}

async function run(binary, args, cwd = temporary) {
  const instance = launch(binary, args, cwd)
  const timer = setTimeout(() => signal(instance, 'SIGKILL'), 120000)
  try {
    const { code, signal } = await instance.ended
    assert.equal(code, 0, `Command ${args.join(' ')} failed (${signal ?? code}):\n${instance.output()}`)
  } finally { clearTimeout(timer) }
  return instance.output()
}

const command = (args, cwd) => run(process.execPath, args, cwd)

async function listening(instance) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const record = instance.records.find((record) => record.message === 'HTTP server listening')
    if (record) return record.fields.url
    if (!instance.child.pid || instance.child.exitCode !== null || instance.child.signalCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Generated server did not start:\n${instance.output()}`)
}

async function exercise(url, runtime) {
  if (runtime === 'workers') {
    const scheduled = await fetch(`${url}/cdn-cgi/mf/scheduled?cron=*+*+*+*+*&time=123000`)
    assert.equal(scheduled.status, 200)
    assert.deepEqual(await (await fetch(`${url}/scheduled`)).json(), { runs: 1, lastScheduledTime: 123000, lastCron: '* * * * *' })
    assert.ok((await (await fetch(`${url}/traces`)).json()).spans.some((span) => span.name === 'worker.scheduled' && span.kind === 'consumer'))
  }
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
  assert.deepEqual(await response.json(), { greeting: 'Generated project', runtime })
  response = await fetch(`${url}/echo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":"  fresh app  "}',
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { message: 'fresh app' })
  const activity = await fetch(`${url}/events`)
  assert.deepEqual(await activity.json(), { events: { echoes: 1, requestId: response.headers.get('X-Request-Id') } })
  response = await fetch(`${url}/echo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":""}',
  })
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error, 'Validation failed')
  assert.equal((await fetch(`${url}/missing`)).status, 404)
}

try {
  for (const runtime of ['node', 'bun', 'deno', 'workers']) {
    const initial = join(temporary, `${runtime}-initial`)
    // Both entrypoints are real executables, not imports of a mocked generator.
    await command(runtime === 'node'
      ? [cli, 'create', initial, '--runtime', runtime]
      : [creator, initial, `--runtime=${runtime}`])
    const directory = join(temporary, `${runtime} relocated project`)
    await rename(initial, directory)
    const packageFile = join(directory, 'package.json')
    const manifest = JSON.parse(await readFile(packageFile, 'utf8'))
    assert.equal(manifest.packageManager, 'pnpm@12.6.0')
    assert.equal(manifest.longhorn.runtime, runtime)
    assert.ok(!JSON.stringify(manifest).includes('workspace:'))
    assert.ok(!JSON.stringify(manifest).includes(root))
    await run('pnpm', ['install', '--reporter=append-only'], directory)
    assert.equal(JSON.parse(await readFile(packageFile, 'utf8')).packageManager, 'pnpm@12.6.0')
    for (const action of ['typecheck', 'test', 'build']) await command([cli, action, '--cwd', directory])
    const executable = launch(process.execPath, [cli, 'start', '--cwd', directory], directory, true)
    try {
      const url = await listening(executable)
      await exercise(url, runtime)
      signal(executable, 'SIGTERM')
      const timeout = setTimeout(() => signal(executable, 'SIGKILL'), 6000)
      try {
        const { code, signal: exitSignal } = await executable.ended
        assert.ok(code === 0 || code === 143 || exitSignal === 'SIGTERM', executable.output())
      } finally { clearTimeout(timeout) }
      assert.ok(executable.records.some((record) => record.message === 'Application stopped'), executable.output())
      await assert.rejects(fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) }), 'Listener still accepts connections after shutdown')
    } finally {
      await stop(executable)
    }

    const development = launch(process.execPath, [cli, 'dev', '--cwd', directory], directory, true)
    try {
      await exercise(await listening(development), runtime)
      const source = join(directory, 'src/app.ts')
      await writeFile(source, (await readFile(source, 'utf8')).replace("status: 'ok'", "status: 'edited'"))
      const deadline = Date.now() + 15000
      let updated = false
      while (Date.now() < deadline) {
        const latest = development.records.filter((record) => record.message === 'HTTP server listening').at(-1)
        try {
          if (latest) {
            const health = await fetch(`${latest.fields.url}/health`, { signal: AbortSignal.timeout(500) })
            if ((await health.json()).status === 'edited') { updated = true; break }
          }
        } catch { /* Native watchers can briefly close the port while restarting. */ }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert.ok(updated, `Source changes were not served in ${runtime} development mode:\n${development.output()}`)
    } finally { await stop(development) }
    const latest = development.records.filter((record) => record.message === 'HTTP server listening').at(-1)
    if (latest) await assert.rejects(fetch(`${latest.fields.url}/health`, { signal: AbortSignal.timeout(1000) }))
    console.log(`${runtime}: generated, relocated, installed, typechecked, tested, built, and served through the CLI; source watching and shutdown verified.`)
  }

  const occupied = join(temporary, 'node relocated project')
  await writeFile(join(occupied, '.keep'), 'preserve')
  const refused = launch(process.execPath, [cli, 'create', occupied, '--runtime', 'node'], temporary)
  assert.equal((await refused.ended).code, 1)
  assert.equal(await readFile(join(occupied, '.keep'), 'utf8'), 'preserve')
  assert.ok(!(await readdir(temporary)).some((name) => name.startsWith('.longhorn-create-')))
  console.log('Creation refuses existing content and leaves no staging directories.')

  if (process.platform !== 'win32') {
    const fakeBin = join(temporary, 'failed-installer')
    await mkdir(fakeBin)
    await writeFile(join(fakeBin, 'pnpm'), '#!/bin/sh\nexit 7\n', { mode: 0o755 })
    const retryable = join(temporary, 'retryable-install')
    const failed = launch(process.execPath, [cli, 'create', retryable, '--runtime', 'node', '--install'], temporary, false, {
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
    })
    assert.equal((await failed.ended).code, 7)
    assert.ok((await readdir(retryable)).includes('package.json'))
    assert.ok(failed.output().includes('Project files were created'))
    console.log('Failed automatic installation preserves generated files and the installer exit status.')
  }

  const cliPack = JSON.parse(await run('pnpm', ['pack', '--json', '--pack-destination', temporary], join(root, 'cli')))
  const creatorPack = JSON.parse(await run('pnpm', ['pack', '--json', '--pack-destination', temporary], join(root, 'create-longhorn')))
  const cliArchive = basename(cliPack.filename)
  const creatorArchive = basename(creatorPack.filename)
  assert.ok(cliPack.files.some((file) => file.path === 'dist/framework/manifest.json'))
  const consumer = join(temporary, 'cli-distribution')
  await mkdir(consumer)
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    private: true, packageManager: 'pnpm@12.6.0', dependencies: {
      '@longhornjs/cli': `file:../${cliArchive}`, 'create-longhorn': `file:../${creatorArchive}`,
    },
  }))
  await writeFile(join(consumer, 'pnpm-workspace.yaml'), `overrides:\n  '@longhornjs/cli': 'file:../${cliArchive}'\n`)
  await run('pnpm', ['install', '--reporter=append-only'], consumer)
  assert.equal((await run('pnpm', ['exec', 'longhorn', '--version'], consumer)).trim(), cliPack.version)
  const packedProject = join(temporary, 'from-packed-generator')
  await run('pnpm', ['exec', 'create-longhorn', packedProject, '--runtime', 'node', '--install'], consumer)
  assert.ok((await readdir(packedProject)).includes('pnpm-lock.yaml'))
  await run('pnpm', ['exec', 'longhorn', 'typecheck', '--cwd', packedProject], consumer)
  await run('pnpm', ['exec', 'longhorn', 'test', '--cwd', packedProject], consumer)
  console.log('Packed CLI binaries create and install an independent project using only their bundled snapshot.')
} finally {
  await Promise.all([...instances].map(stop))
  await rm(temporary, { recursive: true, force: true })
}
