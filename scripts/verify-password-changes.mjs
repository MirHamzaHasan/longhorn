import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { scrypt, timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { startAccountOperationsSandbox } from './account-operations-sandbox.mjs'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { checkPostgresPasswordFunctions } from '../packages/auth/dist/postgres-passwords.js'
import { AuthService } from '../packages/auth/dist/index.js'
import { SqliteAuthStore } from '../packages/auth/dist/sqlite.js'
import { PostgresAuthStore } from '../packages/auth/dist/postgres.js'
import { openSqlite } from '../runtimes/node/dist/sqlite.js'
import { createScryptPasswordHasher } from '../runtimes/node/dist/passwords.js'

const children = new Set(), all = [], secrets = []
const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url), temporary = await mkdtemp(join(tmpdir(), 'longhorn-password-changes-'))
const binaries = { node: process.execPath, bun: join(dirname(require.resolve('bun-runtime/package.json')), 'bin/bun.exe'), deno: join(dirname(require.resolve('deno-runtime/package.json')), process.platform === 'win32' ? 'deno.exe' : 'deno') }
const crashPassword = 'a native crash current passphrase', crashNext = 'a native crash replacement passphrase'
const password = 'a current native PG passphrase', nextPassword = 'a replaced native PG passphrase', origin = 'http://127.0.0.1:3003'
secrets.push(password, nextPassword, crashPassword, crashNext)
let sandbox, database
function safe(value) {
  for (const secret of secrets) value = value.replaceAll(secret, '[redacted]')
  // Unexpected test failures can include a newly issued temporary token not known to the parent.
  return value.replace(/\b[a-f0-9]{64}\b/g, '[private digest]')
}
function launch(binary, args, environment = {}) {
  const child = spawn(binary, args, { cwd: root, detached: process.platform !== 'win32', env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''; const records = []
  for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', line => { output += line + '\n'; try { records.push(JSON.parse(line)) } catch {} })
  child.on('error', () => { output += 'Owned password verifier could not start\n' })
  const owned = { child, records, output: () => output, ended: new Promise(resolve => child.once('close', (code, signal) => { children.delete(owned); resolve({ code, signal }) })) }
  children.add(owned); all.push(owned); return owned
}
function force(owned) {
  if (owned.child.exitCode !== null || owned.child.signalCode !== null) return
  try { if (process.platform !== 'win32') process.kill(-owned.child.pid, 'SIGKILL'); else owned.child.kill('SIGKILL') }
  catch (error) { if (error.code !== 'ESRCH') throw error }
}
async function stop(owned) {
  if (owned.child.exitCode !== null || owned.child.signalCode !== null) { await owned.ended; return }
  owned.child.kill('SIGTERM'); const timer = setTimeout(() => force(owned), 10000)
  try { assert.deepEqual(await owned.ended, { code: 0, signal: null }, safe(owned.output())) }
  finally { clearTimeout(timer) }
}
async function ready(owned) {
  const end = Date.now() + 15000
  while (Date.now() < end) {
    const record = owned.records.find(record => record.message === 'HTTP server listening')
    if (record) return record.url
    if (owned.child.exitCode !== null || owned.child.signalCode !== null) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Owned password host did not start: ' + safe(owned.output()))
}
async function checkpoint(owned) {
  const end = Date.now() + 15000
  while (Date.now() < end) {
    if (owned.records.some(record => record.message === 'Password transaction before commit')) return
    if (owned.child.exitCode !== null || owned.child.signalCode !== null) break
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Native password transaction checkpoint missing: ' + safe(owned.output()))
}
async function crashProof(runtime, filename, database) {
  const stateFile = join(temporary, runtime + '-state.json')
  const entry = join(root, 'scripts/fixtures/password-change-transaction-' + runtime + '.mjs')
  const args = runtime === 'deno' ? ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual', '--allow-read=' + temporary, '--allow-write=' + temporary, entry, filename, stateFile]
    : runtime === 'pg' ? [entry, stateFile] : [entry, filename, stateFile]
  const owned = launch(runtime === 'pg' ? process.execPath : binaries[runtime], args, runtime === 'pg' ? { LONGHORN_PG_APP_URL: sandbox.appUrl } : {})
  await checkpoint(owned)
  const state = JSON.parse(await readFile(stateFile, 'utf8')); secrets.push(state.token, state.passwordHash)
  let inspector = database
  if (!inspector) inspector = await openSqlite({ filename })
  try {
    const store = runtime === 'pg' ? new PostgresAuthStore(inspector) : new SqliteAuthStore(inspector)
    assert.equal((await store.findUserByUsername(state.username)).passwordHash, state.passwordHash)
    force(owned); assert.deepEqual(await owned.ended, { code: null, signal: 'SIGKILL' })
    const auth = new AuthService(store, createScryptPasswordHasher(), { passwordChanges: true })
    assert.ok(await auth.authenticate(state.token))
    await auth.login(state.username, crashPassword)
    assert.equal((await store.findUserByUsername(state.username)).passwordHash, state.passwordHash)
    console.log(runtime + ': actual SIGKILL after native password/session writes rolls the whole transaction back; original credentials and session recover.')
  } finally { if (!database) await inspector.close() }
}
async function drainProof(runtime) {
  const filename = join(temporary, runtime + '-drain.sqlite'), entry = join(root, 'scripts/fixtures/auth-drain-' + runtime + '.mjs')
  const args = runtime === 'deno' ? ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual', '--allow-read=' + temporary, '--allow-write=' + temporary, '--allow-net=127.0.0.1', entry, filename] : [entry, filename]
  const owned = launch(binaries[runtime], args), url = await ready(owned), from = 'http://127.0.0.1:3001'
  assert.equal((await request(url, '/auth/register', { method: 'POST', body: { username: 'drain-user', password }, from })).status, 201)
  const logged = await request(url, '/auth/login', { method: 'POST', body: { username: 'drain-user', password }, from })
  assert.equal(logged.status, 200)
  const cookie = logged.headers.getSetCookie().at(-1).split(';')[0]; secrets.push(cookie.split('=')[1]); await logged.json()
  const count = owned.records.filter(record => record.message === 'Password work entered').length
  const pending = request(url, '/auth/password', { method: 'POST', cookie, body: { currentPassword: password, nextPassword }, from })
  const deadline = Date.now() + 10000
  while (owned.records.filter(record => record.message === 'Password work entered').length === count) {
    assert.ok(Date.now() < deadline, 'Native replacement hash did not start')
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  owned.child.kill('SIGTERM')
  const response = await pending; assert.equal(response.status, 204)
  const timer = setTimeout(() => force(owned), 15000)
  try { assert.deepEqual(await owned.ended, { code: 0, signal: null }, safe(owned.output())) }
  finally { clearTimeout(timer) }
  const messages = owned.records.map(record => record.message)
  assert.ok(messages.lastIndexOf('Password work entered') < messages.indexOf('Drain requested'))
  assert.ok(messages.indexOf('Drain requested') < messages.lastIndexOf('Password work settled'))
  assert.ok(messages.lastIndexOf('Password work settled') < messages.indexOf('Application stopped'))
  const database = await openSqlite({ filename })
  try {
    assert.equal((await database.execute('SELECT count(*) AS n FROM longhorn_auth_sessions')).rows[0].n, 0n)
    const hash = (await database.execute('SELECT password_hash FROM longhorn_auth_users')).rows[0].password_hash; secrets.push(hash)
    assert.ok(await createScryptPasswordHasher().verify(nextPassword, hash))
    assert.equal((await database.execute('PRAGMA integrity_check')).rows[0].integrity_check, 'ok')
  } finally { await database.close() }
  console.log(runtime + ': SIGTERM during actual replacement hashing drains the password/session transaction and accepted HTTP response before native storage close.')
}
const request = (url, path, { method = 'GET', cookie, body, from = origin } = {}) => fetch(url + path, {
  method, headers: { Origin: from, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
})
async function login(url, username, suppliedPassword = password) {
  const response = await request(url, '/account/login', { method: 'POST', body: { username, password: suppliedPassword } })
  assert.equal(response.status, 200)
  const cookie = response.headers.getSetCookie().at(-1).split(';')[0]; secrets.push(cookie.split('=')[1])
  const value = await response.json(); assert.deepEqual(Object.keys(value.session), ['expiresAt'])
  return cookie
}
try {
  for (const runtime of ['node', 'bun', 'deno']) await crashProof(runtime, join(temporary, runtime + '.sqlite'))
  for (const runtime of ['node', 'bun', 'deno']) await drainProof(runtime)
  sandbox = await startAccountOperationsSandbox(); secrets.push(sandbox.ownerUrl, sandbox.appUrl, sandbox.connectionString)
  database = await openPostgres({ connectionString: sandbox.appUrl })
  await checkPostgresPasswordFunctions(database)
  const tests = launch('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.passwords-postgres.config.ts'], {
    LONGHORN_PG_TEST_OWNED: 'true', LONGHORN_PG_TEST_URL: sandbox.ownerUrl, LONGHORN_PG_APP_URL: sandbox.appUrl,
  })
  const timer = setTimeout(() => force(tests), 60000)
  try { const result = await tests.ended; assert.equal(result.code, 0, safe(tests.output())); process.stdout.write(safe(tests.output())) }
  finally { clearTimeout(timer) }
  console.log('Native PostgreSQL password changes: restricted functions, old-login fencing, concurrent replacement, actual SQL rollback and expiry after row ownership passed.')
  await crashProof('pg', undefined, database)
  const owner = await openPostgres({ connectionString: sandbox.ownerUrl })
  try {
    await owner.execute('TRUNCATE longhorn_auth.users,longhorn_auth.sessions,longhorn_auth.attempts,longhorn_pg_example.private_notes RESTART IDENTITY')
    const start = () => launch(process.execPath, [fileURLToPath(new URL('./fixtures/password-change-postgres.mjs', import.meta.url))], { LONGHORN_PG_APP_URL: sandbox.appUrl })
    let first = start(), url = await ready(first)
    const second = start(), peer = await ready(second)
    for (const username of ['alice', 'bob']) assert.equal((await request(url, '/account/register', { method: 'POST', body: { username, password } })).status, 201)
    const alice = await login(url, 'alice'), device = await login(peer, 'alice'), bob = await login(peer, 'bob')
    const created = await request(url, '/account/notes', { method: 'POST', cookie: alice, body: { title: 'Retained across password replacement' } })
    assert.equal(created.status, 201); const note = (await created.json()).note
    assert.equal((await request(url, '/account/password', { method: 'POST', cookie: alice, body: { currentPassword: password, nextPassword }, from: 'https://attacker.example' })).status, 403)
    assert.equal((await request(url, '/account/password', { method: 'POST', cookie: alice, body: { currentPassword: 'wrong', nextPassword } })).status, 401)
    assert.equal((await request(url, '/account/password', { method: 'POST', cookie: alice, body: { currentPassword: password, nextPassword, userId: 'bob' } })).status, 400)
    const before = (await owner.execute("SELECT password_hash FROM longhorn_auth.users WHERE username='alice'")).rows[0].password_hash
    secrets.push(before)
    const changed = await request(url, '/account/password', { method: 'POST', cookie: alice, body: { currentPassword: password, nextPassword } })
    assert.equal(changed.status, 204); assert.ok(changed.headers.getSetCookie().at(-1).includes('Max-Age=0'))
    for (const base of [url, peer]) {
      for (const cookie of [alice, device]) assert.equal((await request(base, '/account/session', { cookie })).status, 401)
      assert.equal((await request(base, '/account/session', { cookie: bob })).status, 200)
      assert.equal((await request(base, '/account/login', { method: 'POST', body: { username: 'alice', password } })).status, 401)
    }
    const fresh = await login(peer, 'alice', nextPassword)
    assert.deepEqual((await (await request(url, '/account/notes', { cookie: fresh })).json()).notes, [note])
    const hash = (await owner.execute("SELECT password_hash FROM longhorn_auth.users WHERE username='alice'")).rows[0].password_hash
    secrets.push(hash); assert.ok(hash !== before)
    assert.ok(/^scrypt\$v=1\$n=131072,r=8,p=1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash), 'Unexpected native password format')
    const fields = hash.split('$'), actual = await new Promise((resolve, reject) => scrypt(nextPassword, Buffer.from(fields[3], 'hex'), 64, { N: 131072, r: 8, p: 1, maxmem: 268435456 }, (error, key) => error ? reject(error) : resolve(key)))
    assert.ok(timingSafeEqual(actual, Buffer.from(fields[4], 'hex')))
    await stop(first); first = start(); url = await ready(first)
    assert.equal((await request(url, '/account/session', { cookie: fresh })).status, 200)
    await login(url, 'alice', nextPassword)
    await stop(first); await stop(second)
    console.log('Native PostgreSQL HTTP: real password replacement, independent crypto, cookie clearing, cross-process all-session revocation, peer/note preservation and retained restart passed.')
  } finally { await owner.close() }
  for (const owned of all) for (const secret of secrets) assert.ok(!owned.output().includes(secret), 'Password-change secret leaked to process logs')
} finally {
  for (const owned of children) force(owned)
  await Promise.allSettled([...children].map(owned => owned.ended))
  await database?.close(); await sandbox?.stop(); await rm(temporary, { recursive: true, force: true })
}
