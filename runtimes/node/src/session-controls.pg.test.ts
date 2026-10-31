import { afterEach, beforeEach, expect, it } from 'vitest'
import { openPostgres } from './postgres.js'
import type { Database } from '@longhornjs/database'
import { AuthService } from '@longhornjs/auth'
import { PostgresAuthStore } from '@longhornjs/auth/postgres'
import { checkPostgresSessionControls } from '@longhornjs/auth/postgres-session-controls'
const passwords = { hash: async (value: string) => 'fixture:' + value, verify: async (value: string, hash: string | undefined) => hash === 'fixture:' + value }
if (process.env.LONGHORN_PG_TEST_OWNED !== 'true' || !process.env.LONGHORN_PG_TEST_URL || !process.env.LONGHORN_PG_APP_URL) throw new Error('Use the owned session-control verifier')
const handles: Database[] = [], password = 'a fixture session passphrase'
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes }); return { promise, resolve } }
async function connect(owner = false) { const db = await openPostgres({ connectionString: owner ? process.env.LONGHORN_PG_TEST_URL! : process.env.LONGHORN_PG_APP_URL!, maxConnections: 1 }); handles.push(db); return db }
beforeEach(async () => { await (await connect(true)).execute('TRUNCATE longhorn_auth.users,longhorn_auth.sessions,longhorn_auth.attempts,longhorn_pg_example.private_notes RESTART IDENTITY') })
afterEach(async () => { await Promise.all(handles.splice(0).map(db => db.close())) })
async function setup() {
  const db = await connect(), store = new PostgresAuthStore(db), auth = new AuthService(store, passwords, { sessionControls: true, passwordChanges: true })
  const user = await auth.register('alice', password), current = (await auth.login('alice', password)).session
  return { db,store,auth,user,current }
}
async function blocked(observer: Database, pid: unknown) {
  const end = Date.now() + 3000
  while (Date.now() < end) {
    if ((await observer.execute({ sql: 'SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE pid=$1::integer AND NOT granted) AS blocked', args: [pid as number] })).rows[0]?.blocked === true) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Expected native lock wait was not observed')
}
it('uses the existing restricted capability, counts live sessions and preserves current/peer credentials', async () => {
  const { db,store,auth,current } = await setup(), owner = await connect(true)
  await checkPostgresSessionControls(db)
  const other = (await auth.login('alice', password)).session
  await auth.register('bob', password); const peer = (await auth.login('bob', password)).session
  await store.createSession({ tokenHash: 'e'.repeat(64), userId: (await store.findUserByUsername('alice'))!.id, expiresAt: 0 })
  expect(await auth.revokeSessions(current.token,'others')).toEqual({ revokedSessions: 1 })
  expect(await auth.authenticate(current.token)).toBeDefined(); expect(await auth.authenticate(other.token)).toBeUndefined(); expect(await auth.authenticate(peer.token)).toBeDefined()
  expect(await auth.revokeSessions(current.token,'others')).toEqual({ revokedSessions: 0 })
  expect((await store.findUserByUsername('alice'))?.passwordHash).toBe('fixture:' + password)
  expect(await auth.revokeSessions(current.token,'all')).toEqual({ revokedSessions: 1 })
  await expect(auth.revokeSessions(current.token,'all')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  await expect(db.execute("UPDATE longhorn_auth.users SET roles='[]'::jsonb")).rejects.toMatchObject({ code: '42501' })
  await expect(db.execute('UPDATE longhorn_auth.sessions SET expires_at=0')).rejects.toMatchObject({ code: '42501' })
  await owner.execute('REVOKE EXECUTE ON FUNCTION longhorn_auth.lock_session_user(text) FROM longhorn_app')
  try { await expect(checkPostgresSessionControls(db)).rejects.toThrow('deployed and granted') }
  finally { await owner.execute('GRANT EXECUTE ON FUNCTION longhorn_auth.lock_session_user(text) TO longhorn_app') }
})
it('serializes reciprocal concurrent controls instead of deadlocking or revoking from stale initiation', async () => {
  const { auth,current } = await setup(), other = (await auth.login('alice',password)).session
  const second = new AuthService(new PostgresAuthStore(await connect()),passwords,{sessionControls:true})
  const outcomes = await Promise.allSettled([auth.revokeSessions(current.token,'others'),second.revokeSessions(other.token,'others')])
  expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1)
  const failure = outcomes.find(value => value.status === 'rejected') as PromiseRejectedResult
  expect(failure.reason).toMatchObject({ code:'INVALID_CREDENTIALS' })
  expect([await auth.authenticate(current.token),await auth.authenticate(other.token)].filter(Boolean)).toHaveLength(1)
})
it('checks initiating expiry after an actual user-row wait before deleting another session', async () => {
  let now=1000
  const db=await connect(), owner=await connect(true), observer=await connect(true), store=new PostgresAuthStore(db)
  const auth=new AuthService(store,passwords,{sessionControls:true,clock:()=>now,sessionTtlMs:1000}), user=await auth.register('alice',password), current=(await auth.login('alice',password)).session, other=(await auth.login('alice',password)).session
  const pid=(await db.execute('SELECT pg_backend_pid() AS pid')).rows[0]!.pid!, entered=deferred(), release=deferred()
  const holder=owner.transaction(async tx=>{await tx.execute({sql:'SELECT id FROM longhorn_auth.users WHERE id=$1 FOR UPDATE',args:[user.id]});entered.resolve();await release.promise})
  await entered.promise;const pending=auth.revokeSessions(current.token,'all')
  try {await blocked(observer,pid);now=2000}finally{release.resolve();await holder}
  await expect(pending).rejects.toMatchObject({code:'INVALID_CREDENTIALS'})
  expect((await owner.execute('SELECT count(*) AS n FROM longhorn_auth.sessions')).rows[0]?.n).toBe(2n)
})
it('joins login advisory ownership and sees a login committed before revocation obtains ownership', async () => {
  const {auth,current}=await setup(), raw=await connect(), entered=deferred(), release=deferred(), observer=await connect(true), controlDb=await connect()
  const controlled=new AuthService(new PostgresAuthStore(controlDb),passwords,{sessionControls:true})
  const wrapped:Database={dialect:'postgres',execute:raw.execute.bind(raw),close:async()=>{},transaction:work=>raw.transaction(async tx=>work({execute:async input=>{
    const result=await tx.execute(input), sql=typeof input==='string'?input:input.sql
    if(sql.includes('pg_advisory_xact_lock_shared')){entered.resolve();await release.promise}return result
  }}))}
  const pendingLogin=new AuthService(new PostgresAuthStore(wrapped),passwords).login('alice',password);await entered.promise
  const pid=(await controlDb.execute('SELECT pg_backend_pid() AS pid')).rows[0]!.pid!, pending=controlled.revokeSessions(current.token,'others')
  try{await blocked(observer,pid)}finally{release.resolve()}
  const logged=await pendingLogin;expect(await pending).toEqual({revokedSessions:1});expect(await auth.authenticate(logged.session.token)).toBeUndefined();expect(await auth.authenticate(current.token)).toBeDefined()
})
it('rejects session control after a concurrent password replacement wins ownership', async () => {
  const {auth,current}=await setup(), raw=await connect(), controlDb=await connect(), observer=await connect(true), entered=deferred(), release=deferred()
  const wrapped:Database={dialect:'postgres',execute:raw.execute.bind(raw),close:async()=>{},transaction:work=>raw.transaction(async tx=>work({execute:async input=>{
    const result=await tx.execute(input), sql=typeof input==='string'?input:input.sql
    if(sql.startsWith('SELECT password_hash,expires_at FROM longhorn_auth.lock_password_change')){entered.resolve();await release.promise}return result
  }}))}
  const change=new AuthService(new PostgresAuthStore(wrapped),passwords,{passwordChanges:true}).changePassword(current.token,password,'a different fixture passphrase');await entered.promise
  const pid=(await controlDb.execute('SELECT pg_backend_pid() AS pid')).rows[0]!.pid!, pending=new AuthService(new PostgresAuthStore(controlDb),passwords,{sessionControls:true}).revokeSessions(current.token,'all')
  try{await blocked(observer,pid)}finally{release.resolve()}
  await change;await expect(pending).rejects.toMatchObject({code:'INVALID_CREDENTIALS'});expect(await auth.authenticate(current.token)).toBeUndefined()
})
it('rolls a failed deletion back and rejects a nonconforming repeatable-read adapter before any writes', async () => {
  const {db,store,auth,current}=await setup(), owner=await connect(true);await auth.login('alice',password)
  await owner.execute("CREATE FUNCTION longhorn_auth.session_test_failure() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $body$ BEGIN RAISE EXCEPTION 'fixture session rollback'; END $body$")
  await owner.execute('CREATE TRIGGER session_test_failure BEFORE DELETE ON longhorn_auth.sessions FOR EACH ROW EXECUTE FUNCTION longhorn_auth.session_test_failure()')
  try{await expect(auth.revokeSessions(current.token,'all')).rejects.toMatchObject({code:'P0001'});expect((await db.execute('SELECT count(*) AS n FROM longhorn_auth.sessions')).rows[0]?.n).toBe(2n)}
  finally{await owner.execute('DROP TRIGGER session_test_failure ON longhorn_auth.sessions');await owner.execute('DROP FUNCTION longhorn_auth.session_test_failure()')}
  const unsafe:Database={dialect:'postgres',execute:db.execute.bind(db),close:async()=>{},transaction:work=>db.transaction(async tx=>{await tx.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');return work(tx)})}
  await expect(new AuthService(new PostgresAuthStore(unsafe),passwords,{sessionControls:true}).revokeSessions(current.token,'all')).rejects.toThrow('READ COMMITTED')
  expect((await db.execute('SELECT count(*) AS n FROM longhorn_auth.sessions')).rows[0]?.n).toBe(2n);expect(await store.findUserByUsername('alice')).toBeDefined()
})
