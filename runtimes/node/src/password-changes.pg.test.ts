import { afterEach, beforeEach, expect, it } from 'vitest'
import { openPostgres } from './postgres.js'
import type { Database } from '@longhornjs/database'
import { AuthService } from '@longhornjs/auth'
import { PostgresAuthStore } from '@longhornjs/auth/postgres'
import { checkPostgresPasswordFunctions, postgresPasswordFunctions } from '@longhornjs/auth/postgres-passwords'
const testPasswords = { hash: async (value: string) => 'fixture:' + value, verify: async (value: string, hash: string | undefined) => hash === 'fixture:' + value }

if (process.env.LONGHORN_PG_TEST_OWNED !== 'true' || !process.env.LONGHORN_PG_TEST_URL || !process.env.LONGHORN_PG_APP_URL) throw new Error('Use the owned password-change verifier')
const handles: Database[] = [], password = 'a fixture current passphrase', nextPassword = 'a different fixture passphrase'
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes }); return { promise, resolve } }
async function connect(owner = false) {
  const database = await openPostgres({ connectionString: owner ? process.env.LONGHORN_PG_TEST_URL! : process.env.LONGHORN_PG_APP_URL!, maxConnections: 1 })
  handles.push(database); return database
}
beforeEach(async () => {
  const owner = await connect(true)
  await owner.execute('TRUNCATE longhorn_auth.users,longhorn_auth.sessions,longhorn_auth.attempts,longhorn_pg_example.private_notes RESTART IDENTITY')
})
afterEach(async () => { await Promise.all(handles.splice(0).map(database => database.close())) })
async function setup() {
  const database = await connect(), store = new PostgresAuthStore(database), auth = new AuthService(store, testPasswords, { passwordChanges: true })
  const user = await auth.register('alice', password), session = (await auth.login('alice', password)).session
  return { database, store, auth, user, session }
}

it('grants only the explicit hardened functions while direct password/role updates remain denied', async () => {
  const database = await connect(), owner = await connect(true)
  for (const signature of postgresPasswordFunctions) {
    const row = (await owner.execute({ sql: `SELECT p.prosecdef,p.provolatile,p.proconfig::text,r.rolsuper,
      pg_catalog.has_function_privilege('public',p.oid,'EXECUTE') AS public_execute
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid=p.proowner WHERE p.oid=$1::regprocedure`, args: [signature] })).rows[0]!
    expect(row.prosecdef).toBe(true); expect(row.provolatile).toBe('v'); expect(row.rolsuper).toBe(false)
    expect(row.proconfig).toContain('pg_catalog, pg_temp'); expect(row.public_execute).toBe(false)
    expect((await database.execute({ sql: "SELECT pg_catalog.has_function_privilege(current_user,$1,'EXECUTE') AS allowed", args: [signature] })).rows[0]?.allowed).toBe(true)
  }
  await expect(database.execute("UPDATE longhorn_auth.users SET password_hash='forged'")).rejects.toMatchObject({ code: '42501' })
  await expect(database.execute("UPDATE longhorn_auth.users SET roles='[\"admin\"]'::jsonb")).rejects.toMatchObject({ code: '42501' })
  const signature = postgresPasswordFunctions[0]!
  await owner.execute('REVOKE EXECUTE ON FUNCTION ' + signature + ' FROM longhorn_app')
  try { await expect(checkPostgresPasswordFunctions(database)).rejects.toThrow('deployed and granted') }
  finally { await owner.execute('GRANT EXECUTE ON FUNCTION ' + signature + ' TO longhorn_app') }
})

it('serializes a password winner against an old-password login already in progress', async () => {
  const { auth, store, session } = await setup(), entered = deferred(), release = deferred()
  const delayed = new AuthService(new PostgresAuthStore(await connect()), { ...testPasswords, verify: async (value, hash) => {
    entered.resolve(); await release.promise; return testPasswords.verify(value, hash)
  } }) // Current login-only hosts sharing the schema also use the credential fence.
  const pending = delayed.login('alice', password, session.token); await entered.promise
  try { await auth.changePassword(session.token, password, nextPassword) } finally { release.resolve() }
  await expect(pending).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  expect((await store.findUserByUsername('alice'))?.passwordHash).toBe('fixture:' + nextPassword)
  expect((await auth.login('alice', nextPassword)).session.token).toMatch(/^[a-f0-9]{64}$/)
  await expect(auth.login('alice', password)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
})

it('allows one concurrent replacement and rejects a stale candidate without overwriting the winner', async () => {
  const { auth, store, session } = await setup(), entered = deferred(), release = deferred()
  const delayed = new AuthService(new PostgresAuthStore(await connect()), { ...testPasswords, hash: async value => {
    entered.resolve(); await release.promise; return testPasswords.hash(value)
  } }, { passwordChanges: true })
  const stale = delayed.changePassword(session.token, password, nextPassword); await entered.promise
  try { await auth.changePassword(session.token, password, 'a third winning passphrase') } finally { release.resolve() }
  await expect(stale).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  expect((await store.findUserByUsername('alice'))?.passwordHash).toBe('fixture:a third winning passphrase')
  expect(await auth.authenticate(session.token)).toBeUndefined()
})

it('rolls back password replacement and session deletion when an actual server trigger fails', async () => {
  const { auth, store, session } = await setup(), owner = await connect(true)
  await owner.execute(`CREATE FUNCTION longhorn_auth.password_test_failure() RETURNS trigger LANGUAGE plpgsql
    SET search_path=pg_catalog,pg_temp AS $body$ BEGIN RAISE EXCEPTION 'fixture password rollback'; END $body$`)
  await owner.execute('CREATE TRIGGER password_test_failure BEFORE DELETE ON longhorn_auth.sessions FOR EACH ROW EXECUTE FUNCTION longhorn_auth.password_test_failure()')
  try {
    await expect(auth.changePassword(session.token, password, nextPassword)).rejects.toMatchObject({ code: 'P0001' })
    expect((await store.findUserByUsername('alice'))?.passwordHash).toBe('fixture:' + password)
    expect(await auth.authenticate(session.token)).toBeDefined()
  } finally {
    await owner.execute('DROP TRIGGER password_test_failure ON longhorn_auth.sessions')
    await owner.execute('DROP FUNCTION longhorn_auth.password_test_failure()')
  }
  await auth.changePassword(session.token, password, nextPassword)
  expect(await auth.authenticate(session.token)).toBeUndefined()
})

it('rechecks expiry after a real user-row lock wait, before changing either hash or sessions', async () => {
  let now = 1000
  const database = await connect(), store = new PostgresAuthStore(database), owner = await connect(true), observer = await connect(true)
  const auth = new AuthService(store, testPasswords, { passwordChanges: true, clock: () => now, sessionTtlMs: 1000 })
  const user = await auth.register('alice', password), session = (await auth.login('alice', password)).session
  const pid = (await database.execute('SELECT pg_backend_pid() AS pid')).rows[0]!.pid!
  const entered = deferred(), release = deferred()
  const holder = owner.transaction(async tx => {
    await tx.execute({ sql: 'SELECT id FROM longhorn_auth.users WHERE id=$1 FOR UPDATE', args: [user.id] })
    entered.resolve(); await release.promise
  })
  await entered.promise
  const pending = auth.changePassword(session.token, password, nextPassword)
  try {
    const end = Date.now() + 3000; let blocked = false
    while (Date.now() < end) {
      blocked = (await observer.execute({ sql: 'SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE pid=$1::integer AND NOT granted) AS blocked', args: [pid] })).rows[0]?.blocked === true
      if (blocked) break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect(blocked).toBe(true); now = 2000
  } finally { release.resolve(); await holder }
  await expect(pending).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  expect((await store.findUserByUsername('alice'))?.passwordHash).toBe('fixture:' + password)
  expect((await owner.execute('SELECT count(*) AS n FROM longhorn_auth.sessions')).rows[0]?.n).toBe(1n)
})

it('pins the native isolation despite session defaults and rejects a nonconforming repeatable adapter', async () => {
  const { database, auth, store, session } = await setup()
  await database.execute("SELECT pg_catalog.set_config('default_transaction_isolation','repeatable read',false) AS setting")
  try {
    const isolation = await database.transaction(async tx => (await tx.execute("SELECT pg_catalog.current_setting('transaction_isolation') AS level")).rows[0]?.level)
    expect(isolation).toBe('read committed')
    await auth.login('alice', password)
    await auth.changePassword(session.token, password, nextPassword)
    const live = (await auth.login('alice', nextPassword)).session
    const nonconforming: Database = { dialect: 'postgres', execute: database.execute.bind(database), close: async () => {},
      transaction: work => database.transaction(async tx => { await tx.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); return work(tx) }) }
    const unsafe = new AuthService(new PostgresAuthStore(nonconforming), testPasswords, { passwordChanges: true })
    await expect(unsafe.login('alice', nextPassword)).rejects.toThrow('READ COMMITTED')
    await expect(unsafe.changePassword(live.token, nextPassword, 'a third fixture password')).rejects.toThrow('READ COMMITTED')
    expect((await store.findUserByUsername('alice'))?.passwordHash).toBe('fixture:' + nextPassword)
    expect((await database.execute('SELECT count(*) AS n FROM longhorn_auth.sessions')).rows[0]?.n).toBe(1n)
  } finally { await database.execute("SELECT pg_catalog.set_config('default_transaction_isolation','read committed',false) AS setting") }
  await auth.login('alice', nextPassword)
})
