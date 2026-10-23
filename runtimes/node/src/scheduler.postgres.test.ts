import { expect,it } from 'vitest'
import type { Database } from '@longhorn/database'
import { Queue } from '@longhorn/queue'
import { PostgresQueueStore } from '@longhorn/queue/postgres'
import { Scheduler } from '@longhorn/scheduler'
import { PostgresSchedulerStore } from '@longhorn/scheduler/postgres'
import { backgroundFixture,dataSchema,deferred } from './background-test-helpers.js'
const { open,resources }=backgroundFixture()
async function setup(time=200) {
  const db=await open(),other=await open(),store=new PostgresSchedulerStore(db)
  const queue=new Queue({ name: 'native.schedule.v1',store: new PostgresQueueStore(db),schema: dataSchema,now: () => time })
  const one=new Scheduler({ store,now: () => time }),two=new Scheduler({ store: new PostgresSchedulerStore(other),now: () => time })
  resources.push(queue,one,two);return { db,other,store,queue,one,two }
}
it('registers immutable definitions concurrently and atomically dispatches a shared backlog once',async () => {
  const { one,two,queue }=await setup()
  const opts={ id: 'shared',intervalMs: 10,startAt: 180,missed: 'catch-up' as const }
  const registrations=await Promise.all([one.every(queue,{ value: 1 },opts),two.every(queue,{ value: 1 },opts)])
  expect(registrations[0]).toEqual(registrations[1])
  const results=await Promise.all([one.tick({ limit: 2 }),two.tick({ limit: 2 })])
  // A skipped locked cursor may require a later poll after its owner's bounded batch commits.
  results.push(await one.tick({ limit: 2 }))
  const dispatched=results.flatMap(result => result.dispatched)
  expect(dispatched.map(row => row.scheduledAt).sort((a,b) => a-b)).toEqual([180,190,200])
  expect(new Set(dispatched.map(row => row.jobId)).size).toBe(3)
  expect(await one.get('shared')).toMatchObject({ dispatchCount: 3,nextAt: 210 })
  expect(await one.every(queue,{ value: 1 },opts)).toMatchObject({ dispatchCount: 3,nextAt: 210 })
  await expect(two.every(queue,{ value: 2 },opts)).rejects.toMatchObject({ name: 'ScheduleConflictError' })
  expect((await queue.runOnce(() => {})).status).toBe('succeeded')
})
it('preserves latest/catch-up/once and UTC cron behavior',async () => {
  const { one,queue }=await setup(180000)
  await one.every(queue,{ value: 1 },{ id: 'latest',intervalMs: 60000,startAt: 0 })
  await one.cron(queue,{ value: 2 },{ id: 'cron',expression: '* * * * *',startAt: 0,missed: 'catch-up' })
  await one.at(queue,{ value: 3 },{ id: 'once',at: 100 })
  const result=await one.tick()
  expect(result.dispatched.filter(row => row.scheduleId==='cron').map(row => row.scheduledAt)).toEqual([0,60000,120000,180000])
  expect(await one.get('latest')).toMatchObject({ dispatchCount: 1,lastScheduledAt: 180000,nextAt: 240000 })
  expect(await one.get('once')).toMatchObject({ state: 'completed',nextAt: null })
})
it('cancels future work without deleting occurrences or reviving the definition',async () => {
  const { one,two,queue }=await setup()
  const opts={ id: 'cancel',intervalMs: 10,startAt: 200 }
  await one.every(queue,{ value: 1 },opts);await one.tick()
  expect(await two.cancel('cancel')).toBe(true);expect(await one.cancel('cancel')).toBe(false)
  expect(await one.every(queue,{ value: 1 },opts)).toMatchObject({ state: 'cancelled',dispatchCount: 1 })
  expect((await one.tick()).dispatched).toEqual([])
  expect(await queue.get('scheduled:cancel:200')).toMatchObject({ state: 'pending' })
})
it('skips a locked schedule and dispatches independent due work',async () => {
  const { db,other,one,queue }=await setup(),entered=deferred(),release=deferred()
  await one.at(queue,{ value: 1 },{ id: 'a',at: 100 });await one.at(queue,{ value: 2 },{ id: 'b',at: 100 })
  const locked=db.transaction(async tx => { await tx.execute("SELECT id FROM longhorn_scheduler.schedules WHERE id='a' FOR UPDATE");entered.resolve();await release.promise })
  await entered.promise
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result=await Promise.race([new PostgresSchedulerStore(other).dispatch({ now: 200,limit: 10 }),
      new Promise<never>((_,reject) => { timer=setTimeout(() => reject(new Error('Dispatcher waited for an unrelated lock')),1500) })])
    expect(result.dispatched.map(row => row.scheduleId)).toEqual(['b']);expect(result.more).toBe(false)
  } finally { clearTimeout(timer);release.resolve();await locked }
  expect((await one.tick()).dispatched.map(row => row.scheduleId)).toEqual(['a'])
})
it('rolls back a queued occurrence when the cursor write fails',async () => {
  const { db,one,queue }=await setup()
  await one.at(queue,{ value: 1 },{ id: 'atomic',at: 100 })
  const wrapped: Database={ dialect: 'postgres',execute: input => db.execute(input),close: () => db.close(),
    transaction: work => db.transaction(tx => work({ dialect: 'postgres',execute(input) {
      if ((typeof input==='string' ? input : input.sql).startsWith('UPDATE longhorn_scheduler.schedules SET state=$2')) return Promise.reject(new Error('cursor write failed'))
      return tx.execute(input)
    } })) }
  await expect(new PostgresSchedulerStore(wrapped).dispatch({ now: 200,limit: 100 })).rejects.toThrow('cursor write failed')
  expect(await queue.get('scheduled:atomic:100')).toBeUndefined()
  expect(await one.get('atomic')).toMatchObject({ dispatchCount: 0,nextAt: 100 })
  expect((await one.tick()).dispatched).toHaveLength(1)
})
it('orders cancellation after a dispatch that already holds its cursor lock',async () => {
  const { db,one,two,queue }=await setup(),entered=deferred(),release=deferred()
  await one.every(queue,{ value: 1 },{ id: 'racing',intervalMs: 100,startAt: 200 })
  const wrapped: Database={ dialect: 'postgres',execute: input => db.execute(input),close: () => db.close(),
    transaction: work => db.transaction(tx => work({ dialect: 'postgres',async execute(input) {
      if ((typeof input==='string' ? input : input.sql).startsWith('UPDATE longhorn_scheduler.schedules SET state=$2')) { entered.resolve();await release.promise }
      return tx.execute(input)
    } })) }
  const dispatch=new PostgresSchedulerStore(wrapped).dispatch({ now: 200,limit: 1 });await entered.promise
  let cancelled=false
  const cancel=two.cancel('racing').then(result => { cancelled=true;return result })
  try { await new Promise(resolve => setTimeout(resolve,30));expect(cancelled).toBe(false) }
  finally { release.resolve();await dispatch }
  expect(await cancel).toBe(true)
  expect(await one.get('racing')).toMatchObject({ state: 'cancelled',dispatchCount: 1,nextAt: null })
  expect(await queue.get('scheduled:racing:200')).toMatchObject({ state: 'pending' })
})
