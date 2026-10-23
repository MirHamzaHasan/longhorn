import { openSqlite } from '../../runtimes/node/dist/sqlite.js'
import { migrate } from '../../packages/database/dist/index.js'
import { Queue } from '../../packages/queue/dist/index.js'
import { queueMigrations, SqliteQueueStore } from '../../packages/queue/dist/sqlite.js'
import { Scheduler } from '../../packages/scheduler/dist/index.js'
import { schedulerMigrations, SqliteSchedulerStore } from '../../packages/scheduler/dist/sqlite.js'

const [mode, filename, argument = '2000'] = process.argv.slice(2)
const database = await openSqlite({ filename })
await migrate(database, [...queueMigrations, ...schedulerMigrations])
let connection = database
if (mode === 'crash') {
  connection = { ...database, transaction: (work) => database.transaction((tx) => work({ execute: async (input) => {
    const sql = typeof input === 'string' ? input : input.sql
    if (sql.startsWith('UPDATE longhorn_schedules SET state = ?')) {
      // A real uncommitted queue insertion exists here. Parent kills this process.
      console.log(JSON.stringify({ transactionPaused: true }))
      await new Promise(() => { setInterval(() => {}, 1000) })
    }
    return tx.execute(input)
  } })) }
}
const schema = { '~standard': { version: 1, vendor: 'process-scheduler', validate(value) { return { value } } } }
const queue = new Queue({ name: 'process.v1', store: new SqliteQueueStore(database), schema })
const scheduler = new Scheduler({ store: new SqliteSchedulerStore(connection), now: () => mode === 'tick' ? Number(argument) : 2000 })
try {
  if (mode === 'seed') {
    console.log(JSON.stringify({ schedule: await scheduler.every(queue, { value: 1 }, { id: 'shared', intervalMs: 100, startAt: 100, missed: 'catch-up' }) }))
  } else if (mode === 'dispatch') {
    console.log(JSON.stringify({ ready: argument }))
    await new Promise((resolve) => { process.stdin.once('data', resolve); process.stdin.resume() })
    process.stdin.destroy()
    while (true) {
      const result = await scheduler.tick({ limit: 1 })
      console.log(JSON.stringify({ dispatcher: argument, ...result }))
      if (!result.more) break
      await new Promise((resolve) => setTimeout(resolve, 15))
    }
  } else if (mode === 'tick' || mode === 'crash') console.log(JSON.stringify(await scheduler.tick()))
  else if (mode === 'cancel') console.log(JSON.stringify({ cancelled: await scheduler.cancel('shared') }))
  else if (mode === 'inspect') {
    console.log(JSON.stringify({ schedule: await scheduler.get('shared'),
      jobs: (await database.execute('SELECT id, state FROM longhorn_queue_jobs ORDER BY id')).rows,
      integrity: (await database.execute('PRAGMA integrity_check')).rows[0].integrity_check,
    }))
  } else throw new Error('Unknown fixture mode')
} finally { await scheduler.close(); await queue.close(); await database.close() }
