import { afterEach, expect, it } from 'vitest'
import { openSqlite } from '@longhornjs/node/sqlite'
import { createLogger } from '@longhornjs/logger'
import { createAuthApp } from './app.js'
import { configSchema } from './config.js'
import type { Longhorn } from '@longhornjs/core'

const applications: Longhorn[] = []
afterEach(async () => { await Promise.all(applications.map((app) => app.close())); applications.length = 0 })
const password = 'a long test passphrase'
const passwords = { hash: async (value: string) => 'fixture:' + value, verify: async (value: string, encoded: string | undefined) => encoded === 'fixture:' + value }

async function setup(clock?: () => number) {
  const records: unknown[] = []
  const database = await openSqlite({ filename: ':memory:' })
  const app = createAuthApp(configSchema.parse({ SESSION_TTL_SECONDS: '1' }), {
    openDatabase: async () => database, passwords, ...(clock ? { clock } : {}),
    logger: createLogger({ sink: (record) => records.push(record) }),
  })
  applications.push(app)
  async function request(path: string, method = 'GET', body?: unknown, cookie?: string, origin = 'http://127.0.0.1:3001') {
    return app.fetch(new Request(`http://localhost${path}`, { method, headers: {
      Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
  }
  async function register(username: string) { expect((await request('/auth/register', 'POST', { username, password })).status).toBe(201) }
  async function login(username: string, previous?: string) {
    const response = await request('/auth/login', 'POST', { username, password }, previous)
    expect(response.status).toBe(200)
    const value = response.headers.getSetCookie().at(-1)!.split(';')[0]!
    return { response, cookie: value }
  }
  return { app, database, request, register, login, records }
}

it('rejects anonymous access, untrusted writes, privilege injection, and oversized bodies', async () => {
  const { request } = await setup()
  expect((await request('/notes')).status).toBe(401)
  expect((await request('/auth/register', 'POST', { username: 'person', password }, undefined, 'https://attacker.example')).status).toBe(403)
  expect((await request('/auth/register', 'POST', { username: 'person', password, roles: ['admin'] })).status).toBe(400)
  expect((await request('/auth/register', 'POST', { username: 'person', password: 'short' })).status).toBe(400)
  expect((await request('/auth/register', 'POST', { username: 'person', password: 'x'.repeat(9000) })).status).toBe(413)
})

it('isolates owner data and uses current roles without exposing password or session secrets', async () => {
  const { database, request, register, login, records } = await setup(() => 1000)
  await register('alice'); await register('bob')
  const alice = await login('alice')
  const bob = await login('bob')
  const aliceBody = await alice.response.json()
  expect(aliceBody.user.roles).toEqual(['member'])
  expect(aliceBody).not.toHaveProperty('session.token')
  const created = await request('/notes', 'POST', { title: 'private content' }, alice.cookie)
  const id = (await created.json()).note.id
  expect((await (await request('/notes', 'GET', undefined, bob.cookie)).json()).notes).toEqual([])
  expect((await request(`/notes/${id}`, 'DELETE', undefined, bob.cookie)).status).toBe(404)
  expect((await request('/admin', 'GET', undefined, alice.cookie)).status).toBe(403)
  await database.execute({ sql: 'UPDATE longhorn_auth_users SET roles = ? WHERE id = ?', args: ['["admin"]', aliceBody.user.id] })
  expect((await request('/admin', 'GET', undefined, alice.cookie)).status).toBe(200)
  await database.execute({ sql: 'UPDATE longhorn_auth_users SET roles = ? WHERE id = ?', args: ['["member"]', aliceBody.user.id] })
  expect((await request('/admin', 'GET', undefined, alice.cookie)).status).toBe(403)
  expect((await request(`/notes/${id}`, 'DELETE', undefined, alice.cookie)).status).toBe(204)
  expect(JSON.stringify(records)).not.toContain(password)
  expect(JSON.stringify(records)).not.toContain(alice.cookie.split('=')[1])
  expect(JSON.stringify(records)).not.toContain('private content')
})

it('rotates login cookies, enforces expiry, and supports idempotent logout/all-device revocation', async () => {
  let now = 1000
  const { request, register, login } = await setup(() => now)
  await register('alice')
  const first = await login('alice')
  const rotated = await login('alice', first.cookie)
  expect((await request('/auth/session', 'GET', undefined, first.cookie)).status).toBe(401)
  expect((await request('/auth/session', 'GET', undefined, rotated.cookie)).status).toBe(200)
  const another = await login('alice')
  expect((await request('/auth/logout-all', 'POST', undefined, rotated.cookie)).status).toBe(204)
  expect((await request('/auth/session', 'GET', undefined, another.cookie)).status).toBe(401)
  const expiring = await login('alice')
  now = 2000
  const expired = await request('/auth/session', 'GET', undefined, expiring.cookie)
  expect(expired.status).toBe(401)
  expect(expired.headers.get('Cache-Control')).toBe('no-store')
  expect((await request('/auth/logout', 'POST', undefined, expiring.cookie)).status).toBe(204)
})

it('returns generic bad-credential responses and a durable retry window', async () => {
  const { request, register } = await setup(() => 1000)
  await register('alice')
  const wrong = await request('/auth/login', 'POST', { username: 'alice', password: 'incorrect' })
  const unknown = await request('/auth/login', 'POST', { username: 'unknown', password: 'incorrect' })
  expect(wrong.status).toBe(unknown.status)
  expect(await wrong.json()).toEqual(await unknown.json())
  for (let attempt = 1; attempt < 10; attempt++) await request('/auth/login', 'POST', { username: 'alice', password: 'incorrect' })
  const blocked = await request('/auth/login', 'POST', { username: 'alice', password })
  expect(blocked.status).toBe(429)
  expect(blocked.headers.get('Retry-After')).toBe('900')
})

it('pages only the authenticated owner with canonical bounded queries and deleted/wide cursors', async () => {
  const { database, request, register, login } = await setup(() => 1000)
  await register('alice'); await register('bob')
  const alice = await login('alice'), bob = await login('bob')
  const aliceId = (await alice.response.json()).user.id, bobId = (await bob.response.json()).user.id
  await database.transaction(async tx => {
    for (let id = 1; id <= 205; id++) await tx.execute({ sql: 'INSERT INTO private_notes(owner_id,title) VALUES(?,?)', args: [id % 2 ? aliceId : bobId, 'Note ' + id] })
  })
  const first = await (await request('/notes', 'GET', undefined, alice.cookie)).json()
  expect(first.notes).toHaveLength(20); expect(first.nextCursor).toBe('39')
  const all: string[] = []; let after: string | null | undefined
  do {
    const page = await (await request('/notes?limit=100' + (after ? '&after=' + after : ''), 'GET', undefined, alice.cookie)).json()
    expect(page.notes.length).toBeLessThanOrEqual(100)
    all.push(...page.notes.map((note: { id: string }) => note.id)); after = page.nextCursor
  } while (after !== null)
  expect(all).toHaveLength(103); expect(all.every(id => BigInt(id) % 2n === 1n)).toBe(true)
  await request('/notes/39', 'DELETE', undefined, alice.cookie)
  const later = await (await request('/notes?after=39&limit=2', 'GET', undefined, alice.cookie)).json()
  expect(later.notes.map((note: { id: string }) => note.id)).toEqual(['41', '43'])
  for (const query of ['limit=0', 'limit=101', 'limit=01', 'after=0', 'after=01', 'after=-1', 'after=9223372036854775808', 'limit=1&limit=2', 'owner_id=' + bobId, 'unknown=1']) {
    expect((await request('/notes?' + query, 'GET', undefined, alice.cookie)).status).toBe(400)
  }
  await database.execute({ sql: 'INSERT INTO private_notes(id,owner_id,title) VALUES(?,?,?)', args: [9223372036854775807n, aliceId, 'Wide'] })
  expect(await (await request('/notes?after=9223372036854775806', 'GET', undefined, alice.cookie)).json()).toEqual({ notes: [{ id: '9223372036854775807', title: 'Wide' }], nextCursor: null })
  expect(await (await request('/notes?after=9223372036854775806', 'GET', undefined, bob.cookie)).json()).toEqual({ notes: [], nextCursor: null })
  const plan = await database.execute({ sql: 'EXPLAIN QUERY PLAN SELECT id,title FROM private_notes WHERE owner_id=? AND id>? ORDER BY id LIMIT ?', args: [aliceId, 39n, 101] })
  expect(plan.rows.some(row => String(row.detail).includes('private_notes_owner'))).toBe(true)
})

it('changes a password through the guarded route and clears every subject cookie while preserving peers and notes', async () => {
  const { request, register, login, records } = await setup(() => 1000)
  await register('alice'); await register('bob')
  const first = await login('alice'), second = await login('alice'), bob = await login('bob')
  const nextPassword = 'a different fixture passphrase'
  await request('/notes', 'POST', { title: 'Retained after password change' }, first.cookie)
  expect((await request('/auth/password', 'POST', { currentPassword: password, nextPassword }, undefined)).status).toBe(401)
  expect((await request('/auth/password', 'POST', { currentPassword: password, nextPassword }, first.cookie, 'https://attacker.example')).status).toBe(403)
  expect((await request('/auth/password', 'POST', { currentPassword: password, nextPassword, userId: 'bob' }, first.cookie)).status).toBe(400)
  const changed = await request('/auth/password', 'POST', { currentPassword: password, nextPassword }, first.cookie)
  expect(changed.status).toBe(204); expect(changed.headers.get('Cache-Control')).toBe('no-store')
  expect(changed.headers.getSetCookie().at(-1)).toContain('longhorn_dev=')
  expect(changed.headers.getSetCookie().at(-1)).toContain('Max-Age=0')
  for (const cookie of [first.cookie, second.cookie]) expect((await request('/auth/session', 'GET', undefined, cookie)).status).toBe(401)
  expect((await request('/auth/session', 'GET', undefined, bob.cookie)).status).toBe(200)
  expect((await request('/auth/login', 'POST', { username: 'alice', password })).status).toBe(401)
  const logged = await request('/auth/login', 'POST', { username: 'alice', password: nextPassword })
  expect(logged.status).toBe(200)
  const cookie = logged.headers.getSetCookie().at(-1)!.split(';')[0]!
  expect((await (await request('/notes', 'GET', undefined, cookie)).json()).notes).toHaveLength(1)
  expect(JSON.stringify(records)).not.toContain(nextPassword)
})

it('preserves the credential and active session on bad reauthentication and shares the durable attempt limit', async () => {
  const { request, register, login } = await setup(() => 1000)
  await register('alice'); const current = await login('alice')
  const nextPassword = 'a different fixture passphrase'
  for (let index = 0; index < 10; index++) expect((await request('/auth/password', 'POST', { currentPassword: 'wrong', nextPassword }, current.cookie)).status).toBe(401)
  expect((await request('/auth/session', 'GET', undefined, current.cookie)).status).toBe(200)
  const blocked = await request('/auth/password', 'POST', { currentPassword: password, nextPassword }, current.cookie)
  expect(blocked.status).toBe(429); expect(blocked.headers.get('Retry-After')).toBe('900')
})


it('reauthenticates scoped session control, keeps the initiator for others and guards strict input/origin', async () => {
  const { request, register, login } = await setup(() => 1000)
  await register('alice'); await register('bob')
  const first = await login('alice'), second = await login('alice'), peer = await login('bob')
  expect((await request('/auth/sessions/revoke', 'POST', { scope: 'all' })).status).toBe(401)
  expect((await request('/auth/sessions/revoke', 'POST', { scope: 'others' }, first.cookie, 'https://attacker.example')).status).toBe(403)
  for (const body of [{ scope: 'invalid' }, { scope: 'all', userId: 'bob' }, {}]) expect((await request('/auth/sessions/revoke', 'POST', body, first.cookie)).status).toBe(400)
  const response = await request('/auth/sessions/revoke', 'POST', { scope: 'others' }, first.cookie)
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ revokedSessions: 1 }); expect(response.headers.get('Set-Cookie')).toBeNull()
  expect((await request('/auth/session', 'GET', undefined, first.cookie)).status).toBe(200)
  expect((await request('/auth/session', 'GET', undefined, second.cookie)).status).toBe(401)
  expect((await request('/auth/session', 'GET', undefined, peer.cookie)).status).toBe(200)
  const ended = await request('/auth/sessions/revoke', 'POST', { scope: 'all' }, first.cookie)
  expect(ended.status).toBe(200); expect(await ended.json()).toEqual({ revokedSessions: 1 }); expect(ended.headers.get('Set-Cookie')).toContain('Max-Age=0')
  expect((await request('/auth/session', 'GET', undefined, first.cookie)).status).toBe(401)
  expect((await request('/auth/session', 'GET', undefined, peer.cookie)).status).toBe(200)
})
