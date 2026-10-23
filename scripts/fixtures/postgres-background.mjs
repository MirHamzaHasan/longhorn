import { openPostgres } from '../../runtimes/node/dist/postgres.js'
import { Queue } from '../../packages/queue/dist/index.js'
import { PostgresQueueStore } from '../../packages/queue/dist/postgres.js'
import { Scheduler } from '../../packages/scheduler/dist/index.js'
import { PostgresSchedulerStore } from '../../packages/scheduler/dist/postgres.js'

if (process.env.LONGHORN_PG_TEST_OWNED !== 'true' || !process.env.LONGHORN_PG_APP_URL) throw new Error('Owned PostgreSQL harness required')
const mode=process.argv[2],name=process.env.LONGHORN_PG_QUEUE ?? 'native.process.v1'
const database=await openPostgres({ connectionString: process.env.LONGHORN_PG_APP_URL,maxConnections: 2 })
const schema={ '~standard': { version: 1,vendor: 'native-process-qa',validate: input => typeof input?.value==='number' ? { value: input } : { issues: [{ message: 'Expected value' }] } } }
const queue=new Queue({ name,schema,store: new PostgresQueueStore(database),leaseMs: 400 })
const scheduler=new Scheduler({ store: new PostgresSchedulerStore(database),now: () => 2000 })
const emit=value => console.log(JSON.stringify(value))
const pause=async value => { const timer=setInterval(() => {},1000);emit(value);try { await new Promise(() => {}) } finally { clearInterval(timer) } }
async function barrier() {
  emit({ ready: true })
  await new Promise(resolve => process.stdin.once('data',resolve))
  process.stdin.pause()
}
async function effect(data,context) {
  await database.execute({ sql: 'INSERT INTO longhorn_pg_example.task_reports(job_id,total,completed) VALUES ($1,$2,0) ON CONFLICT(job_id) DO NOTHING',args: [context.id,data.value] })
}
try {
  if (mode==='consume') {
    await barrier()
    for (let index=0;index<1000;index++) {
      const result=await queue.runOnce(async (data,context) => {
        await effect(data,context);emit({ handled: context.id,attempt: context.attempt })
        await new Promise(resolve => setTimeout(resolve,5))
      })
      emit(result)
      if (result.status==='idle') break
      if (index===999) throw new Error('Consumer did not become idle')
    }
  } else if (mode==='claim-crash' || mode==='effect-crash') {
    await queue.runOnce(async (data,context) => {
      if (mode==='effect-crash') await effect(data,context)
      await pause({ handlerPaused: true,effectCommitted: mode==='effect-crash',id: context.id })
    },{ heartbeat: false })
  } else if (mode==='dispatch') {
    await barrier()
    let idle=0
    while (idle<10) {
      const result=await scheduler.tick({ limit: 1 });emit(result)
      idle=result.dispatched.length ? 0 : idle+1
      await new Promise(resolve => setTimeout(resolve,5))
    }
  } else if (mode==='dispatch-crash') {
    const wrapped={ dialect: 'postgres',execute: input => database.execute(input),close: () => database.close(),
      transaction: work => database.transaction(tx => work({ dialect: 'postgres',async execute(input) {
        if ((typeof input==='string' ? input : input.sql).startsWith('UPDATE longhorn_scheduler.schedules SET state=$2')) await pause({ transactionPaused: true })
        return tx.execute(input)
      } })) }
    await new PostgresSchedulerStore(wrapped).dispatch({ now: 2000,limit: 100 })
  } else throw new Error('Unknown PostgreSQL background fixture mode')
} finally { await scheduler.close();await queue.close();await database.close() }
