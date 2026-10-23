import { openSqlite } from '../../runtimes/node/dist/sqlite.js'
import { migrate } from '../../packages/database/dist/index.js'
import { Queue } from '../../packages/queue/dist/index.js'
import { queueMigrations, SqliteQueueStore } from '../../packages/queue/dist/sqlite.js'

const [mode, filename, argument = '1', attempts = '3'] = process.argv.slice(2)
const database = await openSqlite({ filename })
await migrate(database, [...queueMigrations, { id: 'queue_qa/001_effects', statements: [
  'CREATE TABLE qa_effects (job_id TEXT PRIMARY KEY, value INTEGER NOT NULL) STRICT',
  'CREATE TABLE qa_attempts (job_id TEXT NOT NULL, attempt INTEGER NOT NULL, consumer TEXT NOT NULL, PRIMARY KEY (job_id, attempt)) STRICT',
] }])
const store = new SqliteQueueStore(database)
const schema = { '~standard': { version: 1, vendor: 'process-qa', validate(value) {
  return Number.isSafeInteger(value?.value) && Number.isSafeInteger(value?.failBefore)
    ? { value } : { issues: [{ message: 'Invalid fixture payload' }] }
} } }
const queue = new Queue({ name: 'process.v1', store, schema, leaseMs: 300, retryDelayMs: 20 })
try {
  if (mode === 'seed') {
    const ids = []
    for (let index = 0; index < Number(argument); index++) {
      ids.push((await queue.enqueue({ value: index, failBefore: index === 0 && Number(argument) > 1 ? 1 : 0 }, { maxAttempts: Number(attempts) })).id)
    }
    console.log(JSON.stringify({ seeded: ids }))
  } else if (mode === 'crash') {
    const claim = await store.claim({ queue: queue.name, token: 'crashed-fixture', now: Date.now(), leaseMs: 500 })
    if (!claim) throw new Error('No job to crash')
    console.log(JSON.stringify({ claimed: claim.id, attempt: claim.attempts }))
    await new Promise(() => { setInterval(() => {}, 1000) })
  } else if (mode === 'consume' || mode === 'slow') {
    const deadline = Date.now() + 15000
    while (true) {
      const result = await queue.runOnce(async (data, context) => {
        await database.execute({ sql: 'INSERT INTO qa_attempts (job_id, attempt, consumer) VALUES (?,?,?)',
          args: [context.id, context.attempt, argument] })
        await new Promise((resolve) => setTimeout(resolve, mode === 'slow' ? 750 : 40))
        if (context.attempt <= data.failBefore) throw new Error('Expected retry')
        await database.execute({ sql: 'INSERT INTO qa_effects (job_id, value) VALUES (?,?) ON CONFLICT(job_id) DO NOTHING', args: [context.id, data.value] })
      })
      const remaining = (await database.execute("SELECT COUNT(*) AS count FROM longhorn_queue_jobs WHERE state IN ('pending','running')")).rows[0].count
      if (Number(remaining) === 0) break
      if (Date.now() > deadline) throw new Error('Consumer timeout')
      if (result.status === 'idle') await new Promise((resolve) => setTimeout(resolve, 20))
    }
    console.log(JSON.stringify({ consumed: argument }))
  } else if (mode === 'inspect') {
    const jobs = (await database.execute('SELECT id FROM longhorn_queue_jobs ORDER BY id')).rows
    console.log(JSON.stringify({ jobs: await Promise.all(jobs.map((row) => queue.get(row.id))),
      effects: (await database.execute('SELECT * FROM qa_effects ORDER BY job_id')).rows.map((row) => ({ ...row, value: Number(row.value) })),
      attempts: (await database.execute('SELECT * FROM qa_attempts ORDER BY job_id, attempt')).rows.map((row) => ({ ...row, attempt: Number(row.attempt) })),
      integrity: (await database.execute('PRAGMA integrity_check')).rows[0].integrity_check,
    }))
  } else throw new Error('Unknown fixture mode')
} finally { await queue.close(); await database.close() }
