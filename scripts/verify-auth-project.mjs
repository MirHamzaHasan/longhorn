import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createInterface } from 'node:readline'
import { scrypt, timingSafeEqual } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openSqlite } from '../runtimes/node/dist/sqlite.js'

const root = fileURLToPath(new URL('..', import.meta.url)), temporary = await mkdtemp(join(tmpdir(), 'longhorn-auth-project-'))
const runtimes = process.argv[2] ? [process.argv[2]] : ['node', 'bun', 'deno']
assert.ok(runtimes.every(runtime => ['node', 'bun', 'deno'].includes(runtime)))
const instances = new Set(), all = [], secrets = [], password = '  independent native 🐮 passphrase  ', origin = 'http://127.0.0.1:3001'
secrets.push(password)
function safe(value) { for (const secret of secrets) value = value.replaceAll(secret, '[redacted]'); return value }
function launch(binary, args, cwd, overrides = {}) {
  const environment = { ...process.env, HOST: '127.0.0.1', PORT: '0', AUTH_ORIGIN: origin, AUTH_COOKIE_SECURE: 'false', SESSION_TTL_SECONDS: '3600', LOG_LEVEL: 'info', DATABASE_PATH: undefined, ...overrides }
  for (const [key, value] of Object.entries(environment)) if (value === undefined) delete environment[key]
  const child = spawn(binary, args, { cwd, env: environment, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
  const records = []; let output = ''
  for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', line => { output += line + '\n'; try { records.push(JSON.parse(line)) } catch {} })
  child.on('error', () => { output += 'Owned auth project process could not start\n' })
  const instance = { child, records, output: () => output, ended: new Promise(resolve => child.once('close', (code, signal) => { instances.delete(instance); resolve({ code, signal }) })) }
  instances.add(instance); all.push(instance); return instance
}
function kill(instance, signal) {
  if (instance.child.exitCode !== null || instance.child.signalCode !== null) return
  try {
    if (signal === 'SIGKILL' && process.platform !== 'win32') {
      for (const group of instance.groups ?? [instance.child.pid]) try { process.kill(-group, signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
    } else instance.child.kill(signal)
  }
  catch (error) { if (error.code !== 'ESRCH') throw error }
}
async function captureGroups(instance) {
  if (process.platform !== 'win32') {
    const { stdout } = await promisify(execFile)('ps', ['-axo', 'pid=,ppid=,pgid='])
    const rows = stdout.trim().split('\n').map(row => row.trim().split(/\s+/).map(Number)), owned = new Set([instance.child.pid])
    let count = 0
    while (count !== owned.size) { count = owned.size; for (const [pid, parent] of rows) if (owned.has(parent)) owned.add(pid) }
    instance.groups = new Set(rows.filter(([pid]) => owned.has(pid)).map(([, , group]) => group).filter(group => rows.filter(row => row[2] === group).every(([pid]) => owned.has(pid))))
  }
}
async function force(instance) { await captureGroups(instance); kill(instance, 'SIGKILL') }
async function stop(instance) {
  if (instance.child.exitCode !== null || instance.child.signalCode !== null) { await instance.ended; return }
  await captureGroups(instance)
  kill(instance, 'SIGTERM'); let forced = false
  const timer = setTimeout(() => { forced = true; kill(instance, 'SIGKILL') }, 15000)
  try { const result = await instance.ended; assert.ok(!forced, safe(instance.output())); assert.equal(result.code, 0, safe(instance.output())) }
  finally { clearTimeout(timer) }
}
async function command(binary, args, cwd = temporary, environment) {
  const instance = launch(binary, args, cwd, environment), timer = setTimeout(() => { void force(instance) }, 150000)
  try { const result = await instance.ended; assert.equal(result.code, 0, safe(instance.output())); return instance.output() }
  finally { clearTimeout(timer) }
}
async function waitFor(instance, action) {
  const end = Date.now() + 25000
  while (Date.now() < end) {
    const result = await action(); if (result) return result
    if (instance.child.exitCode !== null || instance.child.signalCode !== null) throw new Error(safe(instance.output()))
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('Auth project condition timed out: ' + safe(instance.output()))
}
const latest = instance => instance.records.filter(row => row.message === 'HTTP server listening').at(-1)?.fields.url
const listening = instance => waitFor(instance, () => latest(instance))
const request = (url, path, { method = 'GET', body, cookie, from = origin } = {}) => fetch(url + path, {
  method, headers: { Origin: from, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
})
async function login(url, username, previous) {
  const response = await request(url, '/auth/login', { method: 'POST', body: { username, password }, cookie: previous })
  assert.equal(response.status, 200)
  const header = response.headers.getSetCookie().at(-1)
  assert.ok(header.startsWith('longhorn_dev=') && header.includes('HttpOnly') && header.includes('SameSite=Strict'))
  const cookie = header.split(';')[0]; secrets.push(cookie.split('=')[1])
  const value = await response.json(); assert.deepEqual(Object.keys(value.session), ['expiresAt'])
  assert.ok(!JSON.stringify(value).includes('passwordHash'))
  assert.ok(Math.abs(value.session.expiresAt - Date.now() - 3600000) < 5000)
  return { cookie, user: value.user }
}
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name)
    if (entry.isDirectory()) await scan(filename)
    else if (entry.isFile()) {
      const source = await readFile(filename, 'utf8')
      assert.ok(!source.includes(root), 'Generated file contains workspace path')
      assert.ok(!source.includes('workspace:*'), 'Generated file contains workspace dependency')
    } else throw new Error('Unexpected generated asset type')
  }
}
try {
  const cliPack = JSON.parse(await command('pnpm', ['pack', '--json', '--pack-destination', temporary], join(root, 'cli')))
  const creatorPack = JSON.parse(await command('pnpm', ['pack', '--json', '--pack-destination', temporary], join(root, 'create-longhorn')))
  for (const runtime of runtimes) assert.ok(cliPack.files.some(file => file.path === 'dist/framework/templates/' + runtime + '-sqlite-auth/template.json'))
  const consumer = join(temporary, 'installed CLI'); await mkdir(consumer)
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, packageManager: 'pnpm@12.6.0', dependencies: { '@longhornjs/cli': 'file:../' + basename(cliPack.filename), 'create-longhorn': 'file:../' + basename(creatorPack.filename) } }))
  await writeFile(join(consumer, 'pnpm-workspace.yaml'), 'overrides:\n  \'@longhornjs/cli\': ' + JSON.stringify('file:../' + basename(cliPack.filename)) + '\n')
  await command('pnpm', ['install', '--reporter=append-only'], consumer)
  const cli = join(consumer, 'node_modules/@longhornjs/cli/dist/bin.js')
  for (const runtime of runtimes) {
    const generated = join(temporary, runtime + '-created'), directory = join(temporary, runtime + ' relocated auth project')
    await command('pnpm', ['exec', 'create-longhorn', generated, '--runtime', runtime, '--template', 'sqlite-auth', '--name', runtime + '-accounts', '--install'], consumer)
    await rename(generated, directory)
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    assert.deepEqual(manifest.longhorn, { schemaVersion: 1, runtime, framework: 'snapshot', template: 'sqlite-auth' })
    const selected = await readdir(join(directory, '.longhorn/framework'))
    for (const other of ['node', 'bun', 'deno', 'workers'].filter(value => value !== runtime)) assert.ok(!selected.includes(other))
    assert.ok(selected.includes('auth')); assert.ok(!selected.includes('cache')); assert.ok(!selected.includes('queue'))
    for (const name of ['app.ts', 'config.ts', 'notes.ts']) assert.equal(await readFile(join(directory, 'src', name), 'utf8'), await readFile(join(root, 'examples/auth/src', name), 'utf8'))
    assert.equal(await readFile(join(directory, 'src/index.ts'), 'utf8'), await readFile(join(root, 'examples/auth/src', runtime === 'node' ? 'index.ts' : runtime + '.ts'), 'utf8'))
    let expected = await readFile(join(root, 'examples/auth/src/app.test.ts'), 'utf8')
    if (runtime !== 'node') expected = expected.replace("from 'vitest'", runtime === 'bun' ? "from 'bun:test'" : "from '../tests/runner.js'").replace("'@longhornjs/node/sqlite'", "'@longhornjs/" + runtime + "/sqlite'")
    assert.equal(await readFile(join(directory, 'src/app.test.ts'), 'utf8'), expected)
    // Scan before installation excludes native node_modules, but covers every shipped source/framework/doc asset.
    const modules = join(directory, 'node_modules'), saved = join(temporary, runtime + '-installed-modules')
    await rename(modules, saved); try { await scan(directory) } finally { await rename(saved, modules) }
    const lock = await readFile(join(directory, 'pnpm-lock.yaml'), 'utf8')
    await command('pnpm', ['install', '--frozen-lockfile', '--reporter=append-only'], directory, { CI: 'true' })
    assert.equal(await readFile(join(directory, 'pnpm-lock.yaml'), 'utf8'), lock)
    for (const action of ['typecheck', 'test', 'build']) {
      const output = await command(process.execPath, [cli, action, '--cwd', directory], consumer)
      if (action === 'test') {
        assert.match(output, runtime === 'bun' ? /8 pass/ : /8 passed/)
        console.log(runtime + ': all eight copied auth application cases passed on the selected native test runner.')
      }
    }
    await command('pnpm', ['run', 'test:persistence'], directory)
    console.log(runtime + ': packed CLI automatic install, relocation/frozen graph, exact editable source, types/build and shipped real native auth persistence passed.')
    const dataRelative = './retained accounts, data/auth.sqlite', filename = join(directory, dataRelative)
    await writeFile(join(directory, '.env'), 'PORT=invalid\nDATABASE_PATH=./wrong.sqlite\nSESSION_TTL_SECONDS=1\n')
    await writeFile(join(directory, '.env.local'), 'PORT=0\nDATABASE_PATH=' + dataRelative + '\nSESSION_TTL_SECONDS=7200\n')
    const start = (overrides = {}) => launch(process.execPath, [cli, 'start', '--cwd', directory], consumer, { PORT: undefined, ...overrides })
    let first = start(), url = await listening(first)
    assert.equal((await request(url, '/notes')).status, 401)
    for (const username of ['alice', 'bob']) assert.equal((await request(url, '/auth/register', { method: 'POST', body: { username, password } })).status, 201)
    const alice = await login(url, 'alice'), bob = await login(url, 'bob')
    const made = await request(url, '/notes', { method: 'POST', body: { title: 'retained private note' }, cookie: alice.cookie })
    assert.equal(made.status, 201); const note = (await made.json()).note
    const inspector = await openSqlite({ filename })
    try {
      for (const row of (await inspector.execute('SELECT password_hash FROM longhorn_auth_users')).rows) {
        const encoded = row.password_hash; secrets.push(encoded)
        const fields = encoded.split('$'); assert.deepEqual(fields.slice(0, 3), ['scrypt', 'v=1', 'n=131072,r=8,p=1'])
        const key = await new Promise((resolve, reject) => scrypt(password, Buffer.from(fields[3], 'hex'), 64, { N: 131072, r: 8, p: 1, maxmem: 268435456 }, (error, key) => error ? reject(error) : resolve(key)))
        assert.ok(timingSafeEqual(key, Buffer.from(fields[4], 'hex')))
      }
      const second = start(), otherUrl = await listening(second)
      assert.equal((await request(otherUrl, '/auth/session', { cookie: alice.cookie })).status, 200)
      const inventoryPeer=await login(otherUrl,'bob'),sessionsResponse=await request(url,'/auth/sessions?limit=50',{cookie:bob.cookie});assert.equal(sessionsResponse.status,200)
      const inventory=await sessionsResponse.json();assert.equal(inventory.sessions.length,2);assert.equal(inventory.nextCursor,null);assert.equal(inventory.sessions.filter(row=>row.current).length,1)
      for(const session of inventory.sessions){assert.deepEqual(Object.keys(session).sort(),['current','expiresAt','id']);assert.match(session.id,/^[a-f0-9]{32}$/)}
      const selected=inventory.sessions.find(row=>!row.current),end=()=>request(otherUrl,'/auth/sessions/end',{method:'POST',cookie:bob.cookie,body:{id:selected.id}})
      assert.deepEqual(await(await end()).json(),{revokedSessions:1,current:false});assert.deepEqual(await(await end()).json(),{revokedSessions:0,current:false})
      assert.equal((await request(url,'/auth/session',{cookie:inventoryPeer.cookie})).status,401);assert.equal((await request(otherUrl,'/auth/session',{cookie:bob.cookie})).status,200)
      await inspector.execute({ sql: 'UPDATE longhorn_auth_users SET roles=? WHERE id=?', args: ['["admin"]', alice.user.id] })
      assert.equal((await request(otherUrl, '/admin', { cookie: alice.cookie })).status, 200)
      await inspector.execute({ sql: 'UPDATE longhorn_auth_users SET roles=? WHERE id=?', args: ['["member"]', alice.user.id] })
      assert.equal((await request(url, '/admin', { cookie: alice.cookie })).status, 403)
      await inspector.transaction(async tx => {
        for (let index = 0; index < 1026; index++) await tx.execute({ sql: 'INSERT INTO private_notes(owner_id,title) VALUES(?,?)', args: [index < 1005 ? alice.user.id : bob.user.id, 'page ' + index] })
      })
      for (const base of [url, otherUrl]) {
        let after, count = 0, previous = 0n
        do {
          const page = await (await request(base, '/notes?limit=100' + (after ? '&after=' + after : ''), { cookie: alice.cookie })).json()
          assert.ok(page.notes.length <= 100)
          for (const note of page.notes) { assert.ok(BigInt(note.id) > previous); previous = BigInt(note.id); assert.ok(note.title === 'retained private note' || Number(note.title.slice(5)) < 1005) }
          count += page.notes.length; assert.ok(count <= 1006); after = page.nextCursor
        } while (after !== null)
        assert.equal(count, 1006)
        for (const query of ['limit=101', 'after=01', 'limit=1&limit=2', 'owner_id=' + bob.user.id]) assert.equal((await request(base, '/notes?' + query, { cookie: alice.cookie })).status, 400)
      }
      if (runtime === 'deno') {
        const policies = (await readdir(directory)).filter(name => name.startsWith('.longhorn-permissions-'))
        assert.equal(policies.length, 2)
        const policy = JSON.parse(await readFile(join(directory, policies[0]), 'utf8')).permissions.longhorn
        assert.equal(policy.read.length, 1)
        assert.equal(await realpath(policy.read[0]), await realpath(join(directory, 'retained accounts, data')))
        assert.deepEqual(policy.write, policy.read)
        assert.deepEqual(policy.net, ['127.0.0.1']); assert.equal(policy.env.length, 7)
        const deno = join(directory, 'node_modules/.bin/deno')
        await command(deno, ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual', '--config=' + join(directory, policies[0]), '--permission-set=longhorn', 'tests/permissions.mjs', policy.read[0], join(temporary, 'denied.txt')], directory)
        await assert.rejects(access(join(temporary, 'denied.txt')))
      }
      const rotated = await login(otherUrl, 'alice', alice.cookie)
      assert.equal((await request(url, '/auth/session', { cookie: alice.cookie })).status, 401)
      await stop(first); first = start(); url = await listening(first)
      assert.equal((await request(url, '/auth/session', { cookie: rotated.cookie })).status, 200)
      assert.equal((await request(otherUrl, '/auth/logout-all', { method: 'POST', cookie: rotated.cookie })).status, 204)
      assert.equal((await request(url, '/auth/session', { cookie: rotated.cookie })).status, 401)
      assert.equal((await request(url, '/auth/session', { cookie: bob.cookie })).status, 200)
      assert.equal((await inspector.execute('PRAGMA integrity_check')).rows[0].integrity_check, 'ok')
      assert.deepEqual((await inspector.execute('SELECT id FROM longhorn_migrations ORDER BY position')).rows.map(row=>row.id),['longhorn_auth/001_users_sessions_attempts','auth_example/001_notes','longhorn_auth/002_session_inventory'])
      await stop(first); await stop(second)
    } finally { await inspector.close() }
    await assert.rejects(access(join(directory, 'wrong.sqlite')))
    assert.equal((await readFile(filename)).subarray(0, 16).toString(), 'SQLite format 3\0')
    const sourcePath = join(directory, 'src/app.ts'), source = await readFile(sourcePath, 'utf8')
    const development = launch(process.execPath, [cli, 'dev', '--cwd', directory], consumer, { PORT: undefined })
    url = await listening(development)
    await writeFile(sourcePath, source + '\ninvalid syntax !!!\n')
    await waitFor(development, () => development.records.some(row => row.message === 'Auth development build failed'))
    assert.equal((await (await request(url, '/health')).json()).status, 'ok')
    const starts = development.records.filter(row => row.message === 'HTTP server listening').length
    await writeFile(sourcePath, source.replace("status: 'ok'", "status: 'edited'"))
    await waitFor(development, async () => {
      try { return (await (await request(latest(development), '/health')).json()).status === 'edited' } catch { return false }
    })
    assert.equal(development.records.filter(row => row.message === 'HTTP server listening').length, starts + 1)
    const messages = development.records.map(row => row.message), lastReady = messages.lastIndexOf('HTTP server listening')
    assert.ok(messages.indexOf('Application stopped') < lastReady)
    url = latest(development); assert.equal((await request(url, '/auth/session', { cookie: bob.cookie })).status, 200)
    await stop(development); await assert.rejects(request(url, '/health'))
    assert.ok(development.records.some(row => row.message === 'Development stopped'))
    await writeFile(sourcePath, source)
    const invalidData = join(temporary, runtime + '-invalid/data.sqlite'), invalid = start({ PORT: 'invalid', DATABASE_PATH: invalidData })
    assert.equal((await invalid.ended).code, 1); assert.ok(invalid.output().includes('PORT')); await assert.rejects(access(join(temporary, runtime + '-invalid')))
    await writeFile(sourcePath, source.replace('CREATE TABLE private_notes (', 'CREATE TABLE private_notes ( '))
    await command(process.execPath, [cli, 'build', '--cwd', directory], consumer)
    const drift = start(); assert.equal((await drift.ended).code, 1); assert.ok(!latest(drift))
    await writeFile(sourcePath, source); await command(process.execPath, [cli, 'build', '--cwd', directory], consumer)
    first = start(); url = await listening(first); assert.equal((await request(url, '/auth/session', { cookie: bob.cookie })).status, 200)
    const page = await (await request(url, '/notes', { cookie: bob.cookie })).json(); assert.equal(page.notes.length, 20); assert.ok(page.nextCursor)
    await stop(first)
    if (process.platform !== 'win32') {
      const terminal = launch(process.execPath, [join(directory, 'dev.mjs')], consumer, { PORT: undefined })
      const address = await listening(terminal)
      await captureGroups(terminal)
      process.kill(-terminal.child.pid, 'SIGINT')
      const timer = setTimeout(() => kill(terminal, 'SIGKILL'), 15000)
      try { assert.deepEqual(await terminal.ended, { code: 0, signal: null }, safe(terminal.output())) }
      finally { clearTimeout(timer) }
      assert.ok(terminal.records.some(row => row.message === 'Application stopped'))
      assert.ok(terminal.records.some(row => row.message === 'Development stopped'))
      await assert.rejects(request(address, '/health'))
    }
    assert.equal((await readdir(directory)).filter(name => name.startsWith('.longhorn-permissions-')).length, 0)
    console.log(runtime + ': independent native crypto, retained roles/sessions, 1006-note owner pages, environment precedence, failed-build retention, serial reload, config/schema denial and native cleanup passed' + (runtime === 'deno' ? ', including literal comma-path permissions and real outside-scope denial.' : '.'))
  }
  for (const instance of all) for (const secret of secrets) assert.ok(!instance.output().includes(secret), 'Secret leaked to project logs')
  console.log('Packed native auth projects contain no workspace paths, unwanted runtime packages or staging leftovers.')
} finally {
  const results = await Promise.allSettled([...instances].map(stop))
  await rm(temporary, { recursive: true, force: true })
  const failures = results.filter(result => result.status === 'rejected')
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Owned auth project cleanup failed')
}
