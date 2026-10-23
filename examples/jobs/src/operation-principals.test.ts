import { afterEach,beforeEach,expect,it } from 'vitest'
import { AuthService } from '@longhorn/auth'
import { SqliteAuthStore,authMigrations } from '@longhorn/auth/sqlite'
import { migrate } from '@longhorn/database'
import type { Database,SqlExecutor } from '@longhorn/database'
import { openSqlite } from '@longhorn/node/sqlite'
import { Outbox } from '@longhorn/outbox'
import { createOutboxOperations } from '@longhorn/outbox/hono'
import { SqliteOutboxStore,outboxMigrations,outboxRecoveryMigrations,outboxAuditMigrations } from '@longhorn/outbox/sqlite'
import { queueMigrations } from '@longhorn/queue/sqlite'
import { Hono } from 'hono'
import { z } from 'zod'
let db: Database,store: SqliteAuthStore,accounts: AuthService,outgoing: Outbox<{value:number}>,now: number
const passwords={async hash(){throw new Error('Unexpected password work')},async verify(){throw new Error('Unexpected password work')}}
beforeEach(async()=>{
  now=1000;db=await openSqlite({filename:':memory:'});store=new SqliteAuthStore(db)
  await migrate(db,[...authMigrations,...queueMigrations,...outboxMigrations,...outboxRecoveryMigrations,...outboxAuditMigrations])
  await store.createUser({id:'user-one',username:'alice',roles:['member'],passwordHash:'unused-test-credential'})
  accounts=new AuthService(store,passwords,{clock:()=>now,sessionTtlMs:1000})
  outgoing=new Outbox({name:'principal.v1',schema:z.object({value:z.number()}),store:new SqliteOutboxStore(db),now:()=>now})
})
afterEach(async()=>{await outgoing.close();await db.close()})
it('authenticates a frozen current principal inside a managed transaction without credentials',async()=>{
  const issued=await accounts.sessions.create('user-one'),principal=await db.transaction(tx=>accounts.authenticateInTransaction(tx,issued.token))
  expect(principal!.user).toEqual({id:'user-one',username:'alice',roles:['member']});expect(Object.isFrozen(principal!.user.roles)).toBe(true)
  expect(principal).not.toHaveProperty('tokenHash');expect(principal!.user).not.toHaveProperty('passwordHash')
})
it('changes roles atomically with revocation and leaves sessions intact on an unchanged grant',async()=>{
  const original=await accounts.sessions.create('user-one')
  expect(await store.setUserRole(' ALICE ','numbers-operator',true)).toMatchObject({status:'updated',revokedSessions:1})
  expect(await accounts.authenticate(original.token)).toBeUndefined()
  const fresh=await accounts.sessions.create('user-one');expect((await db.transaction(tx=>accounts.authenticateInTransaction(tx,fresh.token)))!.user.roles).toContain('numbers-operator')
  expect(await store.setUserRole('alice','numbers-operator',true)).toMatchObject({status:'unchanged',revokedSessions:0});expect(await accounts.authenticate(fresh.token)).toBeDefined()
  expect(await store.setUserRole('alice','numbers-operator',false)).toMatchObject({status:'updated',revokedSessions:1});expect(await accounts.authenticate(fresh.token)).toBeUndefined()
  expect((await store.setUserRole('absent','numbers-operator',true)).status).toBe('missing')
})
it('rejects root/expired/foreign scopes and checks expiry after waiting for a store result',async()=>{
  const issued=await accounts.sessions.create('user-one');let expired!: SqlExecutor
  await expect(accounts.authenticateInTransaction(db,issued.token)).rejects.toThrow('managed transaction')
  await db.transaction(async tx=>{expired=tx});await expect(accounts.authenticateInTransaction(expired,issued.token)).rejects.toThrow('managed transaction')
  const other=await openSqlite({filename:':memory:'})
  try{await expect(other.transaction(tx=>accounts.authenticateInTransaction(tx,issued.token))).rejects.toThrow('different database')}finally{await other.close()}
  const lookup=store.readAuthenticationInTransaction.bind(store)
  store.readAuthenticationInTransaction=async(tx,hash)=>{const record=await lookup(tx,hash);now=2000;return record}
  expect(await db.transaction(tx=>accounts.authenticateInTransaction(tx,issued.token))).toBeUndefined()
})
it('denies without state/audit writes and attributes an allowed recovery to the verified user',async()=>{
  const delivery=await outgoing.enqueue({value:1},{maxAttempts:1});await outgoing.dispatchOnce({async publish(){throw new Error('owned failure')}})
  let token=(await accounts.sessions.create('user-one')).token
  const policy=async(tx:SqlExecutor)=>{const principal=await accounts.authenticateInTransaction(tx,token);if(!principal?.user.roles.includes('numbers-operator'))throw new Error('Forbidden');return{actor:'user:'+principal.user.id}}
  await expect(outgoing.retryFailedAuthorized(delivery.id,{expectedMaxAttempts:1,additionalAttempts:1,reason:'provider-restored'},policy)).rejects.toThrow('Forbidden')
  expect((await outgoing.auditHistory()).records).toHaveLength(0);expect((await outgoing.get(delivery.id))!.state).toBe('failed')
  await store.setUserRole('alice','numbers-operator',true);token=(await accounts.sessions.create('user-one')).token
  const result=await outgoing.retryFailedAuthorized(delivery.id,{expectedMaxAttempts:1,additionalAttempts:1,reason:'provider-restored'},policy)
  expect(result.audit.actor).toBe('user:user-one');expect(result.result.status).toBe('scheduled')
})
it('gates shared HTTP routes before validation and rejects a changed transactional identity',async()=>{
  const denied=new Hono().route('/ops',createOutboxOperations({resolve:()=>outgoing,authorize:c=>c.json({error:'denied'},401)}))
  expect((await denied.request('/ops/deliveries/not-a-uuid/retry',{method:'POST',body:'not json'})).status).toBe(401)
  const router=new Hono().route('/ops',createOutboxOperations({resolve:()=>outgoing,authorize:()=>({actor:'user:one'}),authorizeRetry:async()=>({actor:'user:two'})}))
  const response=await router.request('/ops/deliveries/'+crypto.randomUUID()+'/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedMaxAttempts:1})})
  expect(response.status).toBe(401);expect((await outgoing.auditHistory()).records).toHaveLength(0)
})
