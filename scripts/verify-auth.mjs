import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { openSqlite } from '../runtimes/node/dist/sqlite.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'longhorn-auth-'))
const filename = join(temporary, 'auth.sqlite')
const origin = 'http://127.0.0.1:3001'
const password = 'a long native test passphrase'
const instances = []
const tokens = []
let inspector

function launch(environment = {}) {
  const child = spawn(process.execPath, [join(root, 'examples/auth/dist/index.js')], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
      HOST: '127.0.0.1', PORT: '0', AUTH_ORIGIN: origin, AUTH_COOKIE_SECURE: 'false',
      SESSION_TTL_SECONDS: '28800', DATABASE_PATH: filename, LOG_LEVEL: 'info', ...environment,
    },
  })
  let output = ''
  const records = []
  createInterface({ input: child.stdout }).on('line', (line) => {
    output += `${line}\n`
    try { records.push(JSON.parse(line)) } catch { /* Retain diagnostics. */ }
  })
  child.stderr.on('data', (chunk) => { output += chunk })
  child.on('error', (error) => { output += `${error.stack ?? error}\n` })
  const ended = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })))
  const instance = { child, records, ended, output: () => output }
  instances.push(instance)
  return instance
}
async function ready(instance) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const record = instance.records.find((record) => record.message === 'HTTP server listening')
    if (record) return record.fields.url
    if (!instance.child.pid || instance.child.exitCode !== null || instance.child.signalCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Auth example did not start:\n${instance.output()}`)
}
async function stop(instance) {
  if (instance.child.exitCode !== null || instance.child.signalCode !== null) { await instance.ended; return }
  instance.child.kill('SIGTERM')
  const timer = setTimeout(() => instance.child.kill('SIGKILL'), 5000)
  try {
    const { code, signal } = await instance.ended
    assert.equal(code, 0, `Shutdown ${signal ?? code}: ${instance.output()}`)
    assert.ok(instance.records.some((record) => record.message === 'Application stopped'))
  } finally { clearTimeout(timer) }
}
async function request(url, path, { method = 'GET', body, cookie, requestOrigin = origin } = {}) {
  return fetch(`${url}${path}`, {
    method, headers: { Origin: requestOrigin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
  })
}
async function login(url, username, previous) {
  const response = await request(url, '/auth/login', { method: 'POST', body: { username, password }, cookie: previous })
  assert.equal(response.status, 200, await response.clone().text())
  const cookie = response.headers.getSetCookie().at(-1)
  assert.ok(cookie?.startsWith('longhorn_dev='))
  assert.ok(cookie.includes('HttpOnly') && cookie.includes('SameSite=Strict') && cookie.includes('Path=/'))
  const value = cookie.split(';')[0]
  tokens.push(value.split('=')[1])
  const result = await response.json()
  assert.deepEqual(Object.keys(result.session), ['expiresAt'])
  assert.ok(!JSON.stringify(result).includes('passwordHash'))
  return { cookie: value, user: result.user, expiresAt: result.session.expiresAt }
}

try {
  let first = launch()
  let a = await ready(first)
  assert.equal((await request(a, '/notes')).status, 401)
  assert.equal((await request(a, '/auth/register', { method: 'POST', body: { username: 'alice', password }, requestOrigin: 'https://attacker.example' })).status, 403)
  assert.equal((await request(a, '/auth/register', { method: 'POST', body: { username: 'alice', password, roles: ['admin'] } })).status, 400)
  for (const username of ['alice', 'bob']) {
    const response = await request(a, '/auth/register', { method: 'POST', body: { username, password } })
    assert.equal(response.status, 201, await response.clone().text())
    assert.deepEqual((await response.json()).user.roles, ['member'])
  }
  const wrong = await request(a, '/auth/login', { method: 'POST', body: { username: 'alice', password: 'wrong' } })
  const unknown = await request(a, '/auth/login', { method: 'POST', body: { username: 'absent', password: 'wrong' } })
  assert.equal(wrong.status, 401); assert.equal(unknown.status, 401)
  assert.deepEqual(await wrong.json(), await unknown.json())
  const alice = await login(a, 'alice')
  const bob = await login(a, 'bob')
  const noteResponse = await request(a, '/notes', { method: 'POST', cookie: alice.cookie, body: { title: 'private durable note' } })
  assert.equal(noteResponse.status, 201)
  const note = (await noteResponse.json()).note
  assert.deepEqual(await (await request(a, '/notes', { cookie: bob.cookie })).json(), { notes: [] })
  assert.equal((await request(a, `/notes/${note.id}`, { method: 'DELETE', cookie: bob.cookie })).status, 404)
  assert.equal((await request(a, '/admin', { cookie: alice.cookie })).status, 403)

  const second = launch()
  const b = await ready(second)
  assert.equal((await request(b, '/auth/session', { cookie: alice.cookie })).status, 200)
  inspector = await openSqlite({ filename })
  const hashes = (await inspector.execute('SELECT password_hash FROM longhorn_auth_users')).rows.map((row) => row.password_hash)
  assert.equal(hashes.length, 2)
  assert.ok(hashes.every((value) => /^scrypt\$v=1\$n=131072,r=8,p=1\$/.test(value)))
  assert.notEqual(hashes[0], hashes[1])
  for (const row of (await inspector.execute('SELECT token_hash FROM longhorn_auth_sessions')).rows) assert.ok(!tokens.includes(row.token_hash))
  await inspector.execute({ sql: 'UPDATE longhorn_auth_users SET roles = ? WHERE id = ?', args: ['["admin"]', alice.user.id] })
  assert.equal((await request(b, '/admin', { cookie: alice.cookie })).status, 200)
  await inspector.execute({ sql: 'UPDATE longhorn_auth_users SET roles = ? WHERE id = ?', args: ['["member"]', alice.user.id] })
  assert.equal((await request(a, '/admin', { cookie: alice.cookie })).status, 403)

  const rotated = await login(b, 'alice', alice.cookie)
  assert.equal((await request(a, '/auth/session', { cookie: alice.cookie })).status, 401)
  const device = await login(a, 'alice')
  assert.equal((await request(a, '/auth/logout', { method: 'POST', cookie: rotated.cookie })).status, 204)
  assert.equal((await request(b, '/auth/session', { cookie: rotated.cookie })).status, 401)
  assert.equal((await request(b, '/auth/session', { cookie: device.cookie })).status, 200)
  await stop(first)
  first = launch(); a = await ready(first)
  assert.deepEqual(await (await request(a, '/notes', { cookie: device.cookie })).json(), { notes: [note] })
  const extra = await login(a, 'alice')
  assert.equal((await request(b, '/auth/logout-all', { method: 'POST', cookie: device.cookie })).status, 204)
  for (const cookie of [device.cookie, extra.cookie]) assert.equal((await request(a, '/auth/session', { cookie })).status, 401)
  assert.equal((await request(b, '/auth/session', { cookie: bob.cookie })).status, 200)

  const expiring = launch({ SESSION_TTL_SECONDS: '1' })
  const c = await ready(expiring)
  const short = await login(c, 'bob')
  assert.equal((await request(c, '/auth/session', { cookie: short.cookie })).status, 200)
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, short.expiresAt - Date.now() + 20)))
  const expired = await request(c, '/auth/session', { cookie: short.cookie })
  assert.equal(expired.status, 401)
  assert.equal(expired.headers.get('Cache-Control'), 'no-store')
  await stop(expiring)

  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await request(a, '/auth/login', { method: 'POST', body: { username: 'throttled', password: 'wrong' } })).status, 401)
  }
  const limited = await request(b, '/auth/login', { method: 'POST', body: { username: 'THROTTLED', password } })
  assert.equal(limited.status, 429)
  assert.ok(Number(limited.headers.get('Retry-After')) > 0)
  await stop(first)
  first = launch(); a = await ready(first)
  assert.equal((await request(a, '/auth/login', { method: 'POST', body: { username: 'throttled', password } })).status, 429)
  assert.equal((await inspector.execute('PRAGMA integrity_check')).rows[0]?.integrity_check, 'ok')
  assert.equal((await inspector.execute('SELECT count(*) AS count FROM longhorn_migrations')).rows[0]?.count, 2n)
  await stop(first); await stop(second)
  const invalid = launch({ AUTH_ORIGIN: 'http://remote.example', DATABASE_PATH: join(temporary, 'invalid.sqlite') })
  assert.equal((await invalid.ended).code, 1)
  assert.ok(invalid.output().includes('loopback'))
  for (const instance of instances) {
    assert.ok(!instance.output().includes(password), 'Password leaked to process logs')
    for (const token of tokens) assert.ok(!instance.output().includes(token), 'Session token leaked to process logs')
  }
  console.log('Authentication verified: native scrypt, cookie/origin boundaries, ownership, live roles, durable sessions, rotation, expiry, cross-process revocation, throttling, restart, and secret-free logs.')

  const bundle = join(temporary, 'worker')
  await build({ entry: { worker: join(root, 'scripts/fixtures/auth-worker.ts') }, outDir: bundle,
    format: ['esm'], platform: 'browser', target: 'es2022', bundle: true, splitting: false,
    noExternal: [/^@longhorn\//, 'hono'], silent: true,
  })
  const worker = new Miniflare({ modules: true, modulesRoot: bundle, scriptPath: join(bundle, 'worker.js'),
    compatibilityDate: '2025-07-18', host: '127.0.0.1', port: 0, cf: false, log: new Log(LogLevel.NONE) })
  try {
    const send = (path, method = 'GET', body, cookie, from = 'https://auth.example') => worker.dispatchFetch(`https://auth.example${path}`, {
      method, headers: { Origin: from, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const account = { username: 'portable', password }
    assert.equal((await send('/register', 'POST', account)).status, 201)
    const logged = await send('/login', 'POST', account)
    assert.equal(logged.status, 200)
    const cookie = logged.headers.get('Set-Cookie')
    assert.ok(cookie.startsWith('__Host-id=') && cookie.includes('Secure') && cookie.includes('HttpOnly'))
    const value = cookie.split(';')[0]
    assert.equal((await send('/private', 'GET', undefined, value)).status, 200)
    assert.equal((await send('/logout', 'POST', undefined, value, 'https://other.example')).status, 403)
    assert.equal((await send('/private', 'GET', undefined, value)).status, 200)
    assert.equal((await send('/logout', 'POST', undefined, value)).status, 204)
    assert.equal((await send('/private', 'GET', undefined, value)).status, 401)
    console.log('Shared auth verified in real workerd: browser bundle, Web Crypto sessions, secure cookies, origin checks, and revocation (test-only password/store providers).')
  } finally { await worker.dispose() }
} finally {
  await Promise.all(instances.map(stop))
  await inspector?.close()
  await rm(temporary, { recursive: true, force: true })
}
