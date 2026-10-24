import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { scrypt, timingSafeEqual } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { build } from 'tsup'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { openSqlite } from '../runtimes/node/dist/sqlite.js'

const root = fileURLToPath(new URL('..', import.meta.url)), require = createRequire(import.meta.url)
const directory = await mkdtemp(join(tmpdir(), 'longhorn native passwords ')), children = []
const binaries = { node: process.execPath, bun: join(dirname(require.resolve('bun-runtime/package.json')), 'bin/bun.exe'), deno: join(dirname(require.resolve('deno-runtime/package.json')), process.platform === 'win32' ? 'deno.exe' : 'deno') }
const password = '  shared native 🐮 passphrase  ', filename = join(directory, 'records.json')
function launch(runtime, file, args = [], network = false) {
  const options = runtime === 'deno' ? ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual', '--allow-read=' + directory, '--allow-write=' + directory, ...(network ? ['--allow-net=127.0.0.1'] : [])] : []
  const child = spawn(binaries[runtime], [...options, join(root, file), ...args], { cwd: root, env: { ...process.env, DENO_NO_UPDATE_CHECK: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const records = []; let output = ''
  for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', line => { output += line + '\n'; try { records.push(JSON.parse(line)) } catch {} })
  child.on('error', () => { output += 'Native password fixture could not start\n' })
  const instance = { child, records, output: () => output, ended: new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal }))) }
  children.push(instance); return instance
}
async function finish(instance) {
  const timer = setTimeout(() => instance.child.kill('SIGKILL'), 30000)
  try { assert.deepEqual(await instance.ended, { code: 0, signal: null }, instance.output()) }
  finally { clearTimeout(timer) }
}
async function waitFor(instance, action) {
  const end = Date.now() + 10000
  while (Date.now() < end) {
    const value = action(); if (value) return value
    assert.equal(instance.child.exitCode, null, instance.output()); assert.equal(instance.child.signalCode, null, instance.output())
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error('Native password fixture timed out: ' + instance.output())
}
try {
  // Independent raw Node crypto vector pins the existing Node v1 wire format and work factors.
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
  const key = await new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 268435456 }, (error, key) => error ? reject(error) : resolve(key)))
  const legacy = 'scrypt$v=1$n=131072,r=8,p=1$' + salt.toString('hex') + '$' + key.toString('hex')
  await writeFile(filename, JSON.stringify({ password, records: [{ runtime: 'legacy-node', hash: legacy }] }), { mode: 0o600 })
  for (const runtime of ['node', 'bun', 'deno']) {
    const instance = launch(runtime, 'scripts/fixtures/native-passwords.mjs', [runtime, filename]); await finish(instance)
    assert.ok(!instance.output().includes(password)); console.log(runtime + ': native fixed scrypt, legacy/peer verification, exact Unicode/whitespace, dummy capacity, queue limits and event-loop progress passed.')
  }
  await finish(launch('node', 'scripts/fixtures/native-passwords.mjs', ['node', filename, 'verify']))
  const records = JSON.parse(await readFile(filename, 'utf8')).records
  for (const record of records) {
    for (const instance of children) assert.ok(!instance.output().includes(record.hash), 'Encoded password leaked to process logs')
    const fields = record.hash.split('$'), salt = Buffer.from(fields[3], 'hex'), expected = Buffer.from(fields[4], 'hex')
    const actual = await new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 268435456 }, (error, key) => error ? reject(error) : resolve(key)))
    assert.ok(timingSafeEqual(actual, expected))
  }
  for (const runtime of ['node', 'bun', 'deno']) {
    const file = join(directory, runtime + '-drain.sqlite')
    const instance = launch(runtime, 'scripts/fixtures/auth-drain-' + runtime + '.mjs', [file], true)
    const ready = await waitFor(instance, () => instance.records.find(record => record.message === 'HTTP server listening'))
    const request = fetch(ready.url + '/auth/register', { method: 'POST', headers: { Origin: 'http://127.0.0.1:3001', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'drain-user', password }), signal: AbortSignal.timeout(15000) })
    await waitFor(instance, () => instance.records.find(record => record.message === 'Password work entered'))
    instance.child.kill('SIGTERM')
    const response = await request; assert.equal(response.status, 201); await response.json(); await finish(instance)
    const names = instance.records.map(record => record.message)
    assert.ok(names.indexOf('Password work entered') < names.indexOf('Drain requested'))
    assert.ok(names.indexOf('Drain requested') < names.indexOf('Password work settled'))
    assert.ok(names.indexOf('Password work settled') < names.indexOf('Application stopped'))
    const database = await openSqlite({ filename: file })
    try { assert.equal((await database.execute('SELECT count(*) AS n FROM longhorn_auth_users')).rows[0].n, 1n); assert.equal((await database.execute('PRAGMA integrity_check')).rows[0].integrity_check, 'ok') } finally { await database.close() }
    console.log(runtime + ': actual SIGTERM during native password work retains HTTP/SQL ownership through registration and process close.')
  }
  const outDir = join(directory, 'worker')
  await build({ entry: { worker: join(root, 'scripts/fixtures/scrypt-policy-worker.ts') }, outDir, format: ['esm'], platform: 'browser', target: 'es2022', bundle: true, splitting: false, noExternal: [/^@longhorn\//], silent: true })
  const worker = new Miniflare({ modules: true, modulesRoot: outDir, scriptPath: join(outDir, 'worker.js'), compatibilityDate: '2025-07-18', host: '127.0.0.1', port: 0, cf: false, log: new Log(LogLevel.NONE) })
  try { assert.deepEqual(await (await worker.dispatchFetch('http://localhost')).json(), { policy: true, nativePasswordBackend: false }) }
  finally { await worker.dispose() }
  console.log('Workers: pure policy bundles without native imports and executes with an explicit test-only driver; no Worker password backend is claimed.')
} finally {
  for (const instance of children) if (instance.child.exitCode === null && instance.child.signalCode === null) instance.child.kill('SIGKILL')
  await Promise.allSettled(children.map(instance => instance.ended)); await rm(directory, { recursive: true, force: true })
}
