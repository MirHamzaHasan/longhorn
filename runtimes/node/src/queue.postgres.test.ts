import { expect,it } from 'vitest'
import { Queue } from '@longhornjs/queue'
import { insertPostgresJob,PostgresQueueStore } from '@longhornjs/queue/postgres'
import { backgroundFixture,dataSchema,deferred } from './background-test-helpers.js'
const { open,resources }=backgroundFixture(),name='native.queue.v1'
const input=(id: string=crypto.randomUUID(),maxAttempts=3) => ({ id,queue: name,payload: '{"value":1}',maxAttempts,availableAt: 1000,now: 1000 })
it('claims different jobs across pooled consumers and fences acknowledgements by token and queue',async () => {
  const one=new PostgresQueueStore(await open()),two=new PostgresQueueStore(await open())
  await Promise.all(Array.from({ length: 40 },(_,index) => one.enqueue(input('concurrent-'+index))))
  const claimed=await Promise.all(Array.from({ length: 40 },(_,index) => (index%2 ? one : two).claim({ queue: name,now: 1000,leaseMs: 100,token: 'consumer-'+index })))
  expect(claimed.every(Boolean)).toBe(true);expect(new Set(claimed.map(job => job!.id)).size).toBe(40)
  expect(await one.claim({ queue: name,now: 1000,leaseMs: 100,token: 'idle' })).toBeUndefined()
  const job=claimed[0]!,owned={ queue: name,id: job.id,token: job.leaseToken!,now: 1001 }
  expect(await two.complete({ ...owned,token: 'wrong' })).toBe(false)
  expect(await two.complete({ ...owned,queue: 'different' })).toBe(false)
  expect(await two.complete(owned)).toBe(true);expect(await one.complete(owned)).toBe(false)
})
it('preserves delay/retry/renewal rules and reclaims expired leases without accepting stale owners',async () => {
  const store=new PostgresQueueStore(await open())
  await store.enqueue({ ...input('leased',2),availableAt: 1100 })
  expect(await store.claim({ queue: name,now: 1099,leaseMs: 100,token: 'early' })).toBeUndefined()
  await store.claim({ queue: name,now: 1100,leaseMs: 100,token: 'old' })
  const old={ queue: name,id: 'leased',token: 'old',now: 1150 }
  expect(await store.renew({ ...old,leaseMs: 100 })).toBe(true)
  expect(await store.renew({ ...old,leaseMs: 1 })).toBe(true)
  expect((await store.get(name,'leased'))?.leaseUntil).toBe(1250)
  expect(await store.claim({ queue: name,now: 1200,leaseMs: 100,token: 'too-early' })).toBeUndefined()
  const recovered=await store.claim({ queue: name,now: 1250,leaseMs: 100,token: 'new' })
  expect(recovered).toMatchObject({ attempts: 2,lastFailure: 'lease-expired',leaseToken: 'new' })
  expect(await store.complete({ ...old,now: 1251 })).toBe(false)
  expect(await store.fail({ ...old,now: 1251,retryAt: null,reason: 'handler' })).toBe(false)
  expect(await store.renew({ ...old,now: 1251,leaseMs: 100 })).toBe(false)
  expect(await store.claim({ queue: name,now: 1350,leaseMs: 100,token: 'exhausted' })).toBeUndefined()
  expect(await store.get(name,'leased')).toMatchObject({ state: 'failed',attempts: 2,lastFailure: 'lease-expired',leaseToken: null })
  await store.enqueue(input('retry'))
  await store.claim({ queue: name,now: 1400,leaseMs: 100,token: 'retry-owner' })
  expect(await store.fail({ queue: name,id: 'retry',token: 'retry-owner',now: 1401,retryAt: 1500,reason: 'handler' })).toBe(true)
  expect(await store.claim({ queue: name,now: 1499,leaseMs: 100,token: 'wait' })).toBeUndefined()
  expect(await store.claim({ queue: name,now: 1500,leaseMs: 100,token: 'retry' })).toMatchObject({ id: 'retry',attempts: 2,lastFailure: 'handler' })
})
it('skips a locked oldest job so another consumer can make progress',async () => {
  const db=await open(),other=await open(),store=new PostgresQueueStore(db),entered=deferred(),release=deferred()
  await store.enqueue(input('a'));await store.enqueue(input('b'))
  const locked=db.transaction(async tx => { await tx.execute("SELECT id FROM longhorn_queue.jobs WHERE id='a' FOR UPDATE");entered.resolve();await release.promise })
  await entered.promise
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const claimed=await Promise.race([new PostgresQueueStore(other).claim({ queue: name,now: 1000,leaseMs: 100,token: 'other' }),
      new Promise<never>((_,reject) => { timer=setTimeout(() => reject(new Error('Claim waited for an unrelated lock')),1500) })])
    expect(claimed?.id).toBe('b')
  } finally { clearTimeout(timer);release.resolve();await locked }
})
it('bounds expired backlog recovery and marks final crashed attempts terminal',async () => {
  const db=await open(true),store=new PostgresQueueStore(db)
  await db.execute({ sql: `INSERT INTO longhorn_queue.jobs(queue,id,payload,state,attempts,max_attempts,available_at,created_at,updated_at,lease_token,lease_until)
    SELECT $1,'expired-'||n,'{}','running',1,1,1000,1000,1000,'dead',1100 FROM pg_catalog.generate_series(1,105) AS n`,args: [name] })
  expect(await store.claim({ queue: name,now: 1100,leaseMs: 100,token: 'recover' })).toBeUndefined()
  expect((await db.execute("SELECT count(*) AS count FROM longhorn_queue.jobs WHERE state='failed'")).rows[0]!.count).toBe(100n)
  await store.claim({ queue: name,now: 1100,leaseMs: 100,token: 'recover' })
  expect((await db.execute("SELECT count(*) AS count FROM longhorn_queue.jobs WHERE state='failed'")).rows[0]!.count).toBe(105n)
})
it('uses existing queue validation, retry policy and invalid-payload terminal handling',async () => {
  const db=await open(),store=new PostgresQueueStore(db);let time=1000
  const queue=new Queue({ name,store,schema: dataSchema,now: () => time,retryDelayMs: 50 });resources.push(queue)
  const job=await queue.enqueue({ value: 1 })
  expect(await queue.runOnce(() => { throw new Error('transient') })).toMatchObject({ status: 'retrying' })
  expect(await queue.runOnce(() => {})).toEqual({ status: 'idle' });time=1050
  expect(await queue.runOnce(() => {})).toMatchObject({ status: 'succeeded' })
  expect(await queue.get(job.id)).toMatchObject({ attempts: 2,state: 'succeeded' })
  await store.enqueue({ ...input('invalid'),payload: '{malformed' })
  expect(await queue.runOnce(() => { throw new Error('Handler must not run') })).toMatchObject({ status: 'failed' })
  expect(await store.get(name,'invalid')).toMatchObject({ attempts: 1,lastFailure: 'invalid-payload' })
})
it('renews a real running handler while a competing consumer polls the same database',async () => {
  const store=new PostgresQueueStore(await open()),competitor=new PostgresQueueStore(await open())
  const queue=new Queue({ name,store,schema: dataSchema,leaseMs: 600 });resources.push(queue)
  const job=await queue.enqueue({ value: 1 }),entered=deferred(),release=deferred()
  const work=queue.runOnce(async () => { entered.resolve();await release.promise })
  await entered.promise
  try {
    await new Promise(resolve => setTimeout(resolve,800))
    expect(await competitor.claim({ queue: name,now: Date.now(),leaseMs: 600,token: 'competitor' })).toBeUndefined()
    expect((await store.get(name,job.id))?.attempts).toBe(1)
  } finally { release.resolve();await work }
  expect(await queue.get(job.id)).toMatchObject({ state: 'succeeded',attempts: 1 })
})
it('lets application SQL and queue insertion share a rollback boundary',async () => {
  const db=await open(),store=new PostgresQueueStore(db)
  await expect(db.transaction(async tx => { await insertPostgresJob(tx,input('atomic'));throw new Error('abort') })).rejects.toThrow('abort')
  expect(await store.get(name,'atomic')).toBeUndefined()
})
