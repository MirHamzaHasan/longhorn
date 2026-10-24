import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { openSqlite } from '../runtimes/node/dist/sqlite.js'

const runtime = process.argv[2] ?? 'node'
assert.ok(['node', 'bun', 'deno'].includes(runtime), 'Expected node, bun or deno auth runtime')
const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const binaries = { node: process.execPath, bun: join(dirname(require.resolve('bun-runtime/package.json')), 'bin/bun.exe'), deno: join(dirname(require.resolve('deno-runtime/package.json')), process.platform === 'win32' ? 'deno.exe' : 'deno') }
const temporary = await mkdtemp(join(tmpdir(), 'longhorn-auth-'))
const filename = join(temporary, 'auth.sqlite')
const origin = 'http://127.0.0.1:3001'
const password = 'a long native test passphrase'
const nextPassword = 'a changed native test passphrase'
const instances = []
const tokens = []
let inspector

function launch(environment = {}, target = runtime) {
  const entry = join(root, 'examples/auth/dist/' + (target === 'node' ? 'index' : target) + '.js')
  const args = target === 'deno' ? ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual', '--allow-read=' + temporary, '--allow-write=' + temporary, '--allow-net=127.0.0.1', '--allow-env=HOST,PORT,AUTH_ORIGIN,AUTH_COOKIE_SECURE,SESSION_TTL_SECONDS,DATABASE_PATH,LOG_LEVEL', entry] : [entry]
  const child = spawn(binaries[target], args, {
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
async function login(url, username, previous, suppliedPassword = password) {
  const response = await request(url, '/auth/login', { method: 'POST', body: { username, password: suppliedPassword }, cookie: previous })
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
  assert.deepEqual(await (await request(a, '/notes', { cookie: bob.cookie })).json(), { notes: [], nextCursor: null })
  assert.equal((await request(a, `/notes/${note.id}`, { method: 'DELETE', cookie: bob.cookie })).status, 404)
  assert.equal((await request(a, '/admin', { cookie: alice.cookie })).status, 403)

  const second = launch({}, 'node')
  const b = await ready(second)
  const third = runtime === 'node' ? undefined : launch({}, runtime === 'bun' ? 'deno' : 'bun')
  const thirdUrl = third ? await ready(third) : undefined
  if (thirdUrl) assert.equal((await request(thirdUrl, '/auth/session', { cookie: alice.cookie })).status, 200)
  assert.equal((await request(b, '/auth/session', { cookie: alice.cookie })).status, 200)
  assert.equal((await request(a,'/auth/sessions')).status,401)
  const inventoryPeer=await login(b,'bob'),sessionPage=await request(thirdUrl??a,'/auth/sessions?limit=50',{cookie:bob.cookie})
  assert.equal(sessionPage.status,200);assert.equal(sessionPage.headers.get('cache-control'),'no-store')
  const inventory=await sessionPage.json();assert.equal(inventory.sessions.length,2);assert.equal(inventory.nextCursor,null);assert.equal(inventory.sessions.filter(row=>row.current).length,1)
  for(const row of inventory.sessions){assert.deepEqual(Object.keys(row).sort(),['current','expiresAt','id']);assert.match(row.id,/^[a-f0-9]{32}$/)}
  assert.ok(!/token|password|hash/i.test(JSON.stringify(inventory)))
  const one=await(await request(a,'/auth/sessions?limit=1',{cookie:bob.cookie})).json();assert.ok(one.nextCursor)
  const last=await(await request(b,'/auth/sessions?limit=1&cursor='+one.nextCursor,{cookie:bob.cookie})).json();assert.deepEqual([...one.sessions,...last.sessions],inventory.sessions);assert.equal(last.nextCursor,null)
  assert.equal((await request(b,'/auth/sessions?cursor='+one.nextCursor,{cookie:inventoryPeer.cookie})).status,400)
  for(const query of ['limit=0','limit=51','limit=1&limit=2','owner=other'])assert.equal((await request(a,'/auth/sessions?'+query,{cookie:bob.cookie})).status,400)
  const selected=inventory.sessions.find(row=>!row.current),endOptions={method:'POST',cookie:bob.cookie,body:{id:selected.id}}
  assert.equal((await request(a,'/auth/sessions/end',{...endOptions,requestOrigin:'https://wrong.example'})).status,403)
  assert.equal((await request(a,'/auth/sessions/end',{...endOptions,body:{id:selected.id,owner:'other'}})).status,400)
  assert.deepEqual(await(await request(thirdUrl??b,'/auth/sessions/end',endOptions)).json(),{revokedSessions:1,current:false})
  assert.deepEqual(await(await request(a,'/auth/sessions/end',endOptions)).json(),{revokedSessions:0,current:false})
  assert.equal((await request(a,'/auth/session',{cookie:inventoryPeer.cookie})).status,401)
  const currentPeer=await login(b,'bob'),peerInventory=await(await request(a,'/auth/sessions',{cookie:currentPeer.cookie})).json()
  const endedCurrent=await request(thirdUrl??a,'/auth/sessions/end',{method:'POST',cookie:currentPeer.cookie,body:{id:peerInventory.sessions.find(row=>row.current).id}})
  assert.deepEqual(await endedCurrent.json(),{revokedSessions:1,current:true});assert.ok(endedCurrent.headers.getSetCookie().at(-1).includes('Max-Age=0'))
  assert.equal((await request(b,'/auth/session',{cookie:currentPeer.cookie})).status,401);assert.equal((await request(b,'/auth/session',{cookie:bob.cookie})).status,200)
  console.log(runtime+' HTTP session inventory: public bounded pages, cross-host cursor binding, query/body/origin denial, selected/repeated and current deletion preserve the other browser.')
  inspector = await openSqlite({ filename })
  const hashes = (await inspector.execute('SELECT password_hash FROM longhorn_auth_users')).rows.map((row) => row.password_hash)
  assert.equal(hashes.length, 2)
  assert.ok(hashes.every((value) => /^scrypt\$v=1\$n=131072,r=8,p=1\$/.test(value)))
  assert.notEqual(hashes[0], hashes[1])
  if (thirdUrl) {
    assert.equal((await request(thirdUrl, '/auth/register', { method: 'POST', body: { username: 'third-runtime', password } })).status, 201)
    const peer = await login(thirdUrl, 'third-runtime')
    assert.equal((await request(a, '/auth/session', { cookie: peer.cookie })).status, 200)
    assert.equal((await request(b, '/auth/session', { cookie: peer.cookie })).status, 200)
  }
  for (const row of (await inspector.execute('SELECT token_hash FROM longhorn_auth_sessions')).rows) assert.ok(!tokens.includes(row.token_hash))
  await inspector.execute({ sql: 'UPDATE longhorn_auth_users SET roles = ? WHERE id = ?', args: ['["admin"]', alice.user.id] })
  assert.equal((await request(b, '/admin', { cookie: alice.cookie })).status, 200)
  await inspector.execute({ sql: 'UPDATE longhorn_auth_users SET roles = ? WHERE id = ?', args: ['["member"]', alice.user.id] })
  assert.equal((await request(a, '/admin', { cookie: alice.cookie })).status, 403)

  const rotated = await login(b, 'alice', alice.cookie)
  if (thirdUrl) {
    assert.equal((await request(thirdUrl, '/auth/session', { cookie: rotated.cookie })).status, 200)
    assert.equal((await request(thirdUrl, '/auth/session', { cookie: alice.cookie })).status, 401)
  }
  assert.equal((await request(a, '/auth/session', { cookie: alice.cookie })).status, 401)
  const device = await login(a, 'alice')
  assert.equal((await request(a, '/auth/logout', { method: 'POST', cookie: rotated.cookie })).status, 204)
  assert.equal((await request(b, '/auth/session', { cookie: rotated.cookie })).status, 401)
  assert.equal((await request(b, '/auth/session', { cookie: device.cookie })).status, 200)
  await stop(first)
  first = launch(); a = await ready(first)
  assert.deepEqual(await (await request(a, '/notes', { cookie: device.cookie })).json(), { notes: [note], nextCursor: null })
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
  const paged = await login(a, 'alice')
  await inspector.transaction(async tx => {
    for (let index = 0; index < 1005; index++) {
      await tx.execute({ sql: 'INSERT INTO private_notes(owner_id,title) VALUES(?,?)', args: [alice.user.id, 'private page ' + index] })
      if (index % 50 === 0) await tx.execute({ sql: 'INSERT INTO private_notes(owner_id,title) VALUES(?,?)', args: [bob.user.id, 'bob private row ' + index] })
    }
  })
  const firstPage = await (await request(a, '/notes', { cookie: paged.cookie })).json()
  assert.equal(firstPage.notes.length, 20); assert.ok(firstPage.nextCursor)
  for (const base of [a, b, ...(thirdUrl ? [thirdUrl] : [])]) {
    let after, count = 0; const ids = new Set()
    do {
      const page = await (await request(base, '/notes?limit=100' + (after ? '&after=' + after : ''), { cookie: paged.cookie })).json()
      assert.ok(page.notes.length <= 100)
      for (const value of page.notes) { assert.ok(value.title === note.title || value.title.startsWith('private page ')); assert.ok(!ids.has(value.id)); ids.add(value.id) }
      count += page.notes.length; assert.ok(count <= 1006); after = page.nextCursor
    } while (after !== null)
    assert.equal(count, 1006)
    for (const query of ['limit=101', 'after=01', 'limit=1&limit=2', 'owner_id=' + bob.user.id]) assert.equal((await request(base, '/notes?' + query, { cookie: paged.cookie })).status, 400)
  }
  assert.equal((await request(a, '/notes/' + firstPage.nextCursor, { method: 'DELETE', cookie: paged.cookie })).status, 204)
  const later = await (await request(a, '/notes?after=' + firstPage.nextCursor, { cookie: paged.cookie })).json()
  assert.ok(later.notes.every(value => BigInt(value.id) > BigInt(firstPage.nextCursor)))
  await inspector.execute({ sql: 'INSERT INTO private_notes(id,owner_id,title) VALUES(?,?,?)', args: [9223372036854775807n, alice.user.id, 'wide private cursor'] })
  for (const base of [a, b, ...(thirdUrl ? [thirdUrl] : [])]) {
    assert.deepEqual(await (await request(base, '/notes?after=9223372036854775806', { cookie: paged.cookie })).json(), { notes: [{ id: '9223372036854775807', title: 'wide private cursor' }], nextCursor: null })
    assert.deepEqual(await (await request(base, '/notes?after=9223372036854775806', { cookie: bob.cookie })).json(), { notes: [], nextCursor: null })
  }
  const plan = await inspector.execute({ sql: 'EXPLAIN QUERY PLAN SELECT id,title FROM private_notes WHERE owner_id=? AND id>? ORDER BY id LIMIT ?', args: [alice.user.id, 1n, 101] })
  assert.ok(plan.rows.some(row => String(row.detail).includes('private_notes_owner')))
  assert.equal((await inspector.execute('PRAGMA integrity_check')).rows[0]?.integrity_check, 'ok')
  assert.deepEqual((await inspector.execute('SELECT id FROM longhorn_migrations ORDER BY position')).rows.map(row=>row.id),['longhorn_auth/001_users_sessions_attempts','auth_example/001_notes','longhorn_auth/002_session_inventory'])
  const revokedDevice = await login(b, 'alice')
  const scoped = await request(thirdUrl ?? a, '/auth/sessions/revoke', { method: 'POST', cookie: paged.cookie, body: { scope: 'others' } })
  assert.equal(scoped.status, 200); assert.ok((await scoped.json()).revokedSessions >= 1)
  for (const base of [a,b,...(thirdUrl?[thirdUrl]:[])]) {
    assert.equal((await request(base, '/auth/session', { cookie: paged.cookie })).status, 200)
    assert.equal((await request(base, '/auth/session', { cookie: revokedDevice.cookie })).status, 401)
    assert.equal((await request(base, '/auth/session', { cookie: bob.cookie })).status, 200)
  }
  const changeDevice = await login(b, 'alice')
  assert.equal((await request(a, '/auth/password', { method: 'POST', cookie: paged.cookie, body: { currentPassword: password, nextPassword }, requestOrigin: 'https://attacker.example' })).status, 403)
  assert.equal((await request(a, '/auth/password', { method: 'POST', cookie: paged.cookie, body: { currentPassword: 'wrong', nextPassword } })).status, 401)
  assert.equal((await request(a, '/auth/password', { method: 'POST', cookie: paged.cookie, body: { currentPassword: password, nextPassword, userId: bob.user.id } })).status, 400)
  const changed = await request(a, '/auth/password', { method: 'POST', cookie: paged.cookie, body: { currentPassword: password, nextPassword } })
  assert.equal(changed.status, 204); assert.ok(changed.headers.getSetCookie().at(-1).includes('Max-Age=0'))
  for (const base of [a, b, ...(thirdUrl ? [thirdUrl] : [])]) {
    for (const cookie of [paged.cookie, changeDevice.cookie]) assert.equal((await request(base, '/auth/session', { cookie })).status, 401)
    assert.equal((await request(base, '/auth/session', { cookie: bob.cookie })).status, 200)
    assert.equal((await request(base, '/auth/login', { method: 'POST', body: { username: 'alice', password } })).status, 401)
  }
  const changedLogin = await login(thirdUrl ?? b, 'alice', undefined, nextPassword)
  assert.equal((await request(a, '/auth/session', { cookie: changedLogin.cookie })).status, 200)
  assert.equal((await (await request(b, '/notes?limit=1', { cookie: changedLogin.cookie })).json()).notes.length, 1)
  await stop(first); first = launch(); a = await ready(first)
  assert.equal((await request(a, '/auth/session', { cookie: changedLogin.cookie })).status, 200)
  await login(a, 'alice', undefined, nextPassword)
  const encodedHashes = [...hashes, ...(await inspector.execute('SELECT password_hash FROM longhorn_auth_users')).rows.map(row => row.password_hash)]
  await stop(first); await stop(second); if (third) await stop(third)
  const invalid = launch({ AUTH_ORIGIN: 'http://remote.example', DATABASE_PATH: join(temporary, 'invalid.sqlite') })
  assert.equal((await invalid.ended).code, 1)
  assert.ok(invalid.output().includes('loopback'))
  for (const instance of instances) {
    assert.ok(!instance.output().includes(password), 'Password leaked to process logs')
    assert.ok(!instance.output().includes(nextPassword), 'Changed password leaked to process logs')
    for (const token of tokens) assert.ok(!instance.output().includes(token), 'Session token leaked to process logs')
    for (const hash of encodedHashes) assert.ok(!instance.output().includes(hash), 'Encoded password leaked to process logs')
  }
  console.log(runtime + ' authentication verified: native scrypt, password change/all-session revocation, cookie/origin boundaries, ownership, live roles, durable sessions, rotation, expiry, cross-process revocation, throttling, restart, and secret-free logs.')

  if (runtime === 'node') {
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
  }
} finally {
  await Promise.all(instances.map(stop))
  await inspector?.close()
  await rm(temporary, { recursive: true, force: true })
}
