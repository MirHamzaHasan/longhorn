import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { startHost, stopHost } from '../host.mjs'

const directory = await mkdtemp(join(tmpdir(), 'longhorn-auth-persistence-')), hosts = [], tokens = []
const password = 'a long native persistence passphrase', origin = 'http://127.0.0.1:3001'
const nextPassword = 'a changed native persistence passphrase'
const environment = { HOST: '127.0.0.1', PORT: '0', AUTH_ORIGIN: origin, AUTH_COOKIE_SECURE: 'false',
  SESSION_TTL_SECONDS: '28800', DATABASE_PATH: join(directory, 'accounts.sqlite'), LOG_LEVEL: 'info' }
async function start() {
  const owned = await startHost({ environment, stdio: ['ignore', 'pipe', 'pipe'] })
  const records = []; let output = ''
  for (const stream of [owned.child.stdout, owned.child.stderr]) createInterface({ input: stream }).on('line', line => {
    output += line + '\n'; try { records.push(JSON.parse(line)) } catch {}
  })
  Object.assign(owned, { records, output: () => output }); hosts.push(owned)
  const end = Date.now() + 15000
  while (Date.now() < end) {
    const ready = records.find(record => record.message === 'HTTP server listening')
    if (ready) return { owned, url: ready.fields.url }
    if (!owned.child.pid || owned.child.exitCode !== null || owned.child.signalCode !== null) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('Native auth persistence host did not start')
}
const request = (url, path, { method = 'GET', body, cookie, from = origin } = {}) => fetch(url + path, {
  method, headers: { Origin: from, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
})
async function login(url, username, previous, suppliedPassword = password) {
  const response = await request(url, '/auth/login', { method: 'POST', body: { username, password: suppliedPassword }, cookie: previous })
  assert.equal(response.status, 200)
  const header = response.headers.getSetCookie().at(-1)
  assert.ok(header.startsWith('longhorn_dev=') && header.includes('HttpOnly') && header.includes('SameSite=Strict'))
  const cookie = header.split(';')[0]; tokens.push(cookie.split('=')[1])
  const value = await response.json(); assert.deepEqual(Object.keys(value.session), ['expiresAt'])
  assert.ok(!JSON.stringify(value).includes('passwordHash')); return cookie
}
try {
  let first = await start()
  assert.equal((await request(first.url, '/notes')).status, 401)
  assert.equal((await request(first.url, '/auth/register', { method: 'POST', body: { username: 'alice', password }, from: 'https://attacker.example' })).status, 403)
  assert.equal((await request(first.url, '/auth/register', { method: 'POST', body: { username: 'alice', password, roles: ['admin'] } })).status, 400)
  for (const username of ['alice', 'bob']) {
    const response = await request(first.url, '/auth/register', { method: 'POST', body: { username, password } })
    assert.equal(response.status, 201); assert.deepEqual((await response.json()).user.roles, ['member'])
  }
  const alice = await login(first.url, 'alice'), bob = await login(first.url, 'bob')
  const created = await request(first.url, '/notes', { method: 'POST', body: { title: 'Private retained note' }, cookie: alice })
  assert.equal(created.status, 201); const note = (await created.json()).note
  assert.deepEqual(await (await request(first.url, '/notes', { cookie: bob })).json(), { notes: [], nextCursor: null })
  assert.equal((await request(first.url, '/notes/' + note.id, { method: 'DELETE', cookie: bob })).status, 404)
  assert.equal((await request(first.url, '/admin', { cookie: alice })).status, 403)
  assert.equal((await request(first.url, '/notes?owner_id=someone', { cookie: alice })).status, 400)
  await stopHost(first.owned)
  first = await start()
  assert.deepEqual(await (await request(first.url, '/notes', { cookie: alice })).json(), { notes: [note], nextCursor: null })
  const second = await start(), rotated = await login(second.url, 'alice', alice)
  assert.equal((await request(first.url, '/auth/session', { cookie: alice })).status, 401)
  assert.equal((await request(first.url, '/auth/session', { cookie: rotated })).status, 200)
  const other = await login(first.url, 'alice')
  assert.equal((await request(second.url, '/auth/logout-all', { method: 'POST', cookie: rotated })).status, 204)
  for (const cookie of [rotated, other]) assert.equal((await request(first.url, '/auth/session', { cookie })).status, 401)
  assert.equal((await request(second.url, '/auth/session', { cookie: bob })).status, 200)
  const current = await login(first.url, 'alice'), device = await login(second.url, 'alice')
  const changed = await request(first.url, '/auth/password', { method: 'POST', cookie: current, body: { currentPassword: password, nextPassword } })
  assert.equal(changed.status, 204); assert.ok(changed.headers.getSetCookie().at(-1).includes('Max-Age=0'))
  for (const cookie of [current, device]) assert.equal((await request(second.url, '/auth/session', { cookie })).status, 401)
  assert.equal((await request(second.url, '/auth/session', { cookie: bob })).status, 200)
  assert.equal((await request(first.url, '/auth/login', { method: 'POST', body: { username: 'alice', password } })).status, 401)
  const fresh = await login(second.url, 'alice', undefined, nextPassword)
  assert.deepEqual(await (await request(first.url, '/notes', { cookie: fresh })).json(), { notes: [note], nextCursor: null })
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await request(first.url, '/auth/login', { method: 'POST', body: { username: 'alice', password: 'wrong' } })).status, 401)
  }
  await stopHost(first.owned)
  first = await start()
  const blocked = await request(first.url, '/auth/login', { method: 'POST', body: { username: 'alice', password: nextPassword } })
  assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers.get('Retry-After')) > 0)
  await stopHost(first.owned); await stopHost(second.owned)
  for (const host of hosts) {
    assert.ok(!host.output().includes(password)); assert.ok(!host.output().includes(nextPassword)); assert.ok(!host.output().includes('scrypt$v=1$'))
    for (const token of tokens) assert.ok(!host.output().includes(token))
    assert.ok(host.records.some(record => record.message === 'Application stopped'))
  }
  console.log('Native auth persistence: actual passwords/change/all-session revocation, retained accounts/sessions/notes, owner/origin/role checks, rotation/revocation, durable throttle and clean close passed.')
} finally {
  const results = await Promise.allSettled(hosts.map(stopHost))
  await rm(directory, { recursive: true, force: true })
  const failures = results.filter(result => result.status === 'rejected')
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Native auth persistence cleanup failed')
}
