import { afterEach,beforeEach,expect,it } from 'vitest'
import { AuthService,SessionManager } from '@longhornjs/auth'
import { PostgresAuthStore } from '@longhornjs/auth/postgres'
import type { Database } from '@longhornjs/database'
import { openPostgres } from './postgres.js'
import type { PostgresDatabase } from './postgres.js'
if (process.env.LONGHORN_PG_TEST_OWNED!=='true' || !process.env.LONGHORN_PG_TEST_URL || !process.env.LONGHORN_PG_APP_URL) throw new Error('Use pnpm test:postgres with its owned native database')
const databases: PostgresDatabase[]=[]
async function open(owner=false) {
  const db=await openPostgres({ connectionString: (owner ? process.env.LONGHORN_PG_TEST_URL : process.env.LONGHORN_PG_APP_URL)! });databases.push(db);return db
}
beforeEach(async () => { const owner=await open(true);await owner.execute('TRUNCATE longhorn_auth.users,longhorn_auth.sessions,longhorn_auth.attempts,longhorn_pg_example.private_notes RESTART IDENTITY') })
afterEach(async () => { for (const db of databases.splice(0).reverse()) await db.close() })
// Store/service test fixture only. The compiled HTTP gate separately verifies native scrypt.
const passwords={ hash: async (password: string) => 'qa:'+password,verify: async (password: string,hash: string | undefined) => hash==='qa:'+password }
const password='a native auth test passphrase'
const account=(username='alice') => ({ id: crypto.randomUUID(),username,passwordHash: 'fixture-encoded',roles: ['member'] })

it('serializes concurrent unique registration and excludes credential material from user lookup',async () => {
  const a=new PostgresAuthStore(await open()),b=new PostgresAuthStore(await open())
  const results=await Promise.all(Array.from({ length: 12 },(_,index) => (index%2 ? a : b).createUser(account())))
  expect(results.filter(Boolean)).toHaveLength(1)
  const credential=await a.findUserByUsername('alice');expect(credential?.roles).toEqual(['member'])
  expect(await b.findUserById(credential!.id)).toEqual({ id: credential!.id,username: 'alice',roles: ['member'] })
  expect(await a.findUserByUsername('absent')).toBeUndefined()
})
it('shares hashed sessions and current roles across pools and cascades deleted accounts',async () => {
  const db=await open(),owner=await open(true),a=new AuthService(new PostgresAuthStore(db),passwords),b=new AuthService(new PostgresAuthStore(await open()),passwords)
  const user=await a.register('Alice',password),{ session }=await a.login('alice',password)
  expect((await db.execute('SELECT token_hash FROM longhorn_auth.sessions')).rows[0]!.token_hash).not.toBe(session.token)
  expect((await b.authenticate(session.token))?.user).toEqual(user)
  await owner.execute({ sql: 'UPDATE longhorn_auth.users SET roles=$1::jsonb WHERE id=$2',args: ['["admin"]',user.id] })
  expect((await a.authenticate(session.token))?.user.roles).toEqual(['admin'])
  await owner.execute({ sql: 'INSERT INTO longhorn_pg_example.private_notes(owner_id,title) VALUES ($1,$2)',args: [user.id,'cascade'] })
  await owner.execute({ sql: 'DELETE FROM longhorn_auth.users WHERE id=$1',args: [user.id] })
  expect(await b.authenticate(session.token)).toBeUndefined()
  expect((await owner.execute('SELECT count(*) AS count FROM longhorn_auth.sessions')).rows[0]!.count).toBe(0n)
  expect((await owner.execute('SELECT count(*) AS count FROM longhorn_pg_example.private_notes')).rows[0]!.count).toBe(0n)
})
it('rotates sessions atomically and rolls back both inserted/revoked records on failure',async () => {
  const db=await open(),store=new PostgresAuthStore(db),user=account();await store.createUser(user)
  const old='a'.repeat(64),next='b'.repeat(64);await store.createSession({ tokenHash: old,userId: user.id,expiresAt: 2000 })
  await expect(store.createSession({ tokenHash: next,userId: 'missing',expiresAt: 2000 },old)).rejects.toMatchObject({ code: '23503' })
  expect(await store.findSession(old)).toBeDefined()
  const wrapped: Database={ dialect: 'postgres',execute: input => db.execute(input),close: () => db.close(),transaction: work => db.transaction(tx => work({ dialect: 'postgres',async execute(input) {
    const result=await tx.execute(input)
    if ((typeof input==='string' ? input : input.sql).startsWith('DELETE FROM longhorn_auth.sessions')) throw new Error('replacement interrupted')
    return result
  } })) }
  await expect(new PostgresAuthStore(wrapped).createSession({ tokenHash: next,userId: user.id,expiresAt: 2000 },old)).rejects.toThrow('replacement interrupted')
  expect(await store.findSession(old)).toBeDefined();expect(await store.findSession(next)).toBeUndefined()
  await store.createSession({ tokenHash: next,userId: user.id,expiresAt: 2000 },old)
  expect(await store.findSession(old)).toBeUndefined();expect(await store.findSession(next)).toBeDefined()
})
it('atomically saturates login reservations across pools and resets at the exact boundary',async () => {
  const a=new PostgresAuthStore(await open()),b=new PostgresAuthStore(await open())
  const results=await Promise.all(Array.from({ length: 30 },(_,index) => (index%2 ? a : b).consumeLoginAttempt('key',1000,3,1000)))
  expect(results.filter(value => value===undefined)).toHaveLength(3)
  expect(results.filter(value => value===2000)).toHaveLength(27)
  expect(await b.consumeLoginAttempt('key',2000,3,1000)).toBeUndefined()
  await a.clearLoginAttempts('key');expect(await b.consumeLoginAttempt('key',2001,3,1000)).toBeUndefined()
})
it('deletes expired throttle windows in bounded batches without removing active windows',async () => {
  const db=await open(),store=new PostgresAuthStore(db)
  for (let index=0;index<5;index++) await store.consumeLoginAttempt('expired-'+index,1000,3,1000)
  await store.consumeLoginAttempt('active',1500,3,1000)
  expect(await store.deleteExpiredLoginAttempts(2000,2)).toBe(2)
  expect(await store.deleteExpiredLoginAttempts(2000,2)).toBe(2)
  expect(await store.deleteExpiredLoginAttempts(2000,2)).toBe(1)
  expect((await db.execute('SELECT key FROM longhorn_auth.attempts')).rows).toEqual([{ key: 'active' }])
})
it('enforces exact expiry and shares single/all-device revocation without a cache',async () => {
  const a=new PostgresAuthStore(await open()),b=new PostgresAuthStore(await open()),user=account();await a.createUser(user)
  let now=1000
  const one=new SessionManager(a,{ ttlMs: 1000,clock: () => now }),two=new SessionManager(b,{ ttlMs: 1000,clock: () => now })
  const expiring=await one.create(user.id);now=2000
  expect(await two.authenticate(expiring.token)).toBeUndefined()
  expect(await one.purgeExpired()).toBe(0)
  const first=await one.create(user.id),second=await two.create(user.id)
  await two.revoke(first.token);expect(await one.authenticate(first.token)).toBeUndefined();expect(await one.authenticate(second.token)).toBeDefined()
  await one.revokeAll(user.id);expect(await two.authenticate(second.token)).toBeUndefined()
  await a.createSession({ tokenHash: 'c'.repeat(64),userId: user.id,expiresAt: 2000 })
  expect(await two.purgeExpired()).toBe(1)
})
it('fails closed on malformed persisted roles and denies unneeded runtime user/session writes',async () => {
  const db=await open(),owner=await open(true),store=new PostgresAuthStore(db),user=account();await store.createUser(user)
  await expect(db.execute("UPDATE longhorn_auth.users SET roles='[\"admin\"]'::jsonb")).rejects.toMatchObject({ code: '42501' })
  await expect(db.execute('DELETE FROM longhorn_auth.users')).rejects.toMatchObject({ code: '42501' })
  await expect(db.execute('UPDATE longhorn_auth.sessions SET expires_at=0')).rejects.toMatchObject({ code: '42501' })
  await expect(db.execute('CREATE TABLE longhorn_auth.forbidden(id integer)')).rejects.toMatchObject({ code: '42501' })
  await owner.execute("UPDATE longhorn_auth.users SET roles='[null]'::jsonb")
  await expect(store.findUserById(user.id)).rejects.toThrow('roles')
})
