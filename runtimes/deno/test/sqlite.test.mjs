import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openSqlite } from '../dist/sqlite.js'
import { migrate } from '../../../packages/database/dist/index.js'
import { assertTransactionExecutor, participateInTransaction } from '../../../packages/database/dist/transactions.js'
import { Queue } from '../../../packages/queue/dist/index.js'
import { queueMigrations, SqliteQueueStore } from '../../../packages/queue/dist/sqlite.js'
import { enqueueInTransaction } from '../../../packages/queue/dist/transaction.js'
import { Scheduler } from '../../../packages/scheduler/dist/index.js'
import { schedulerMigrations, SqliteSchedulerStore } from '../../../packages/scheduler/dist/sqlite.js'
import { Idempotency } from '../../../packages/idempotency/dist/index.js'
import { idempotencyMigrations, SqliteIdempotencyStore } from '../../../packages/idempotency/dist/sqlite.js'

const resources = [], directories = [], sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function database(options = {}) { const db = await openSqlite({ filename: ':memory:', ...options }); resources.push(db); return db }
async function filename() { const directory = await mkdtemp(join(tmpdir(), 'longhorn deno sqlite ')); directories.push(directory); return join(directory, 'data #1.sqlite') }
afterEach(async () => {
  const failures = []
  for (const value of resources.splice(0).reverse()) try { await value.close() } catch (error) { failures.push(error) }
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  if (failures.length) throw new AggregateError(failures, 'Native Deno cleanup failed')
})

test('native int64, float, boolean, null and copied blob values', async () => {
  const db = await database()
  const args = [9223372036854775807n, 1.25, true, false, null, new Uint8Array([0, 255]), '😀']
  assert.deepEqual((await db.execute({ sql: 'SELECT ? AS id, ? AS real, ? AS yes, ? AS no, ? AS empty_value, ? AS body, ? AS text', args })).rows[0], {
    id: args[0], real: 1.25, yes: 1n, no: 0n, empty_value: null, body: args[5], text: '😀',
  })
  for (const value of [NaN, Infinity, 9007199254740992, 9223372036854775808n, -(2n ** 63n) - 1n, '\uD800', undefined]) {
    await assert.rejects(db.execute({ sql: 'SELECT ?', args: [value] }), { code: 'input' })
  }
})

test('snapshots SQL, argv and blob contents before pending admission', async () => {
  const db = await database(), entered = deferred(), release = deferred()
  const tx = db.transaction(async () => { entered.resolve(); await release.promise })
  await entered.promise
  const bytes = new Uint8Array([1, 2]), args = [bytes], query = { sql: 'SELECT ? AS body', args }
  const reading = db.execute(query)
  query.sql = 'SELECT 99'; args[0] = 'changed'; bytes[0] = 9
  release.resolve(); await tx
  assert.deepEqual((await reading).rows[0].body, new Uint8Array([1, 2]))
})

test('bindings preserve SQLite slot numbering, names and literal/comment boundaries', async () => {
  const db = await database()
  const row = (await db.execute({
    sql: "SELECT ?2 AS second, ?1 AS first, :named AS third, :named AS repeated, @named AS fourth, $ns::part(key) AS fifth, ? AS sixth, '?' AS literal, 7 AS [price$tag] /* :ignored ?99 */ -- ?\n",
    args: [11, 22, 33, 44, 55, 66],
  })).rows[0]
  assert.deepEqual(row, { second: 22n, first: 11n, third: 33n, repeated: 33n, fourth: 44n, fifth: 55n, sixth: 66n, literal: '?', 'price$tag': 7n })
  assert.deepEqual((await db.execute({ sql: 'SELECT ?3 AS hole, :é AS unicode, ?1 AS first', args: [1, 2, 3, 4] })).rows[0], { hole: 3n, unicode: 4n, first: 1n })
  assert.deepEqual((await db.execute({ sql: "SELECT :x AS one, ?1 AS same, :x AS repeated, 'it''s ?' AS text", args: [5] })).rows[0], { one: 5n, same: 5n, repeated: 5n, text: "it's ?" })
  assert.deepEqual((await db.execute({ sql: 'SELECT ?, ?1, :x, ?4', args: [5, 6, 7, 8] })).rows[0], { '?': 5n, '?1': 5n, ':x': 6n, '?4': 8n })
})

test('missing/extra bindings and trailing/control SQL reject before write effects', async () => {
  const db = await database(); await db.execute('CREATE TABLE source(v TEXT)')
  for (const args of [[], [1, 2]]) await assert.rejects(db.execute({ sql: 'INSERT INTO source VALUES(?)', args }), { code: 'input' })
  for (const sql of ["INSERT INTO source VALUES('secret'); SELECT 1", '/* c */ BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT x', 'RELEASE x', 'END', 'SELECT 1; /* c */ SELECT 2', '/* unclosed', "SELECT 'unclosed", 'SELECT ?0', 'SELECT ?1001']) {
    await assert.rejects(db.execute(sql), { code: 'input' })
  }
  assert.equal((await db.execute('SELECT * FROM source')).rows.length, 0)
  assert.equal((await db.execute("SELECT ';' AS semi /* ; */; -- tail")).rows[0].semi, ';')
})

test('native metadata excludes trigger effects and stale read changes', async () => {
  const db = await database()
  await db.execute('CREATE TABLE source(id INTEGER PRIMARY KEY, v TEXT)')
  await db.execute('CREATE TABLE audit(v TEXT)')
  await db.execute("CREATE TRIGGER record AFTER INSERT ON source BEGIN INSERT INTO audit VALUES(CASE WHEN NEW.v='one' THEN 'yes' ELSE 'no' END); INSERT INTO audit VALUES('again'); END;")
  const inserted = await db.execute("INSERT INTO source(v) VALUES('one') RETURNING id")
  assert.equal(inserted.rowsAffected, 1); assert.equal(inserted.lastInsertId, 1n)
  assert.equal((await db.execute('SELECT * FROM audit')).rows.length, 2)
  assert.equal((await db.execute('SELECT * FROM source')).rowsAffected, 0)
  assert.equal((await db.execute("UPDATE source SET v='two'")).rowsAffected, 1)
  assert.equal((await db.execute('DELETE FROM source WHERE id=99')).rowsAffected, 0)
})

test('async callbacks hold native transactions, roll back DDL and expire executors', async () => {
  const db = await database(), failure = new Error('business failure'); let expired
  await assert.rejects(db.transaction(async tx => {
    expired = tx; assertTransactionExecutor(tx, db)
    await tx.execute('CREATE TABLE temporary(v TEXT)'); await sleep(1)
    await tx.execute("INSERT INTO temporary VALUES('lost')"); throw failure
  }), error => error === failure)
  await assert.rejects(db.execute('SELECT * FROM temporary'), { code: 'storage' })
  await assert.rejects(expired.execute('SELECT 1'), /closed/)
  await db.execute('CREATE TABLE temporary(v TEXT)')
  assert.equal(await db.transaction(async tx => { await tx.execute("INSERT INTO temporary VALUES('saved')"); await sleep(1); return 'result' }), 'result')
  assert.deepEqual((await db.execute('SELECT v FROM temporary')).rows, [{ v: 'saved' }])
})

test('caught automatic native rollback cannot permit later autocommit', async () => {
  const db = await database()
  await db.execute('CREATE TABLE unique_values(id INTEGER PRIMARY KEY)'); await db.execute('INSERT INTO unique_values VALUES(1)')
  await assert.rejects(db.transaction(async tx => {
    await tx.execute('INSERT INTO unique_values VALUES(2)')
    await assert.rejects(tx.execute('INSERT OR ROLLBACK INTO unique_values VALUES(1)'), { code: 'storage' })
    await assert.rejects(tx.execute('INSERT INTO unique_values VALUES(3)'), { code: 'transaction' })
  }), { code: 'transaction' })
  assert.deepEqual((await db.execute('SELECT id FROM unique_values')).rows, [{ id: 1n }])
  await db.transaction(async tx => { await tx.execute('INSERT INTO unique_values VALUES(4)') })
})

test('canonical same-file handles serialize async work and reject callback reentrancy', async () => {
  const file = await filename(), first = await database({ filename: file }), alias = file + '.alias'
  await symlink(file, alias); const second = await database({ filename: alias })
  await first.execute('CREATE TABLE entries(v INTEGER)')
  const entered = deferred(), release = deferred()
  const tx = first.transaction(async executor => {
    await executor.execute('INSERT INTO entries VALUES(1)')
    for (const handle of [first, second]) {
      await assert.rejects(handle.execute('SELECT 1'), { code: 'transaction' })
      await assert.rejects(handle.transaction(async () => {}), { code: 'transaction' })
      await assert.rejects(handle.close(), { code: 'transaction' })
    }
    await assert.rejects(openSqlite({ filename: alias }), { code: 'transaction' })
    entered.resolve(); await release.promise
  })
  await entered.promise
  let returned = false; const reading = second.execute('SELECT * FROM entries').then(value => { returned = true; return value })
  await sleep(5); assert.equal(returned, false); release.resolve(); await tx
  assert.deepEqual((await reading).rows, [{ v: 1n }])
})

test('bounded admission and close retain accepted work until actual completion', async () => {
  const db = await database({ maxPending: 2 }), entered = deferred(), release = deferred()
  const tx = db.transaction(async executor => { entered.resolve(); await release.promise; await executor.execute('CREATE TABLE after_wait(v TEXT)') })
  await entered.promise
  const accepted = db.execute('SELECT * FROM after_wait')
  await assert.rejects(db.execute('SELECT 1'), { code: 'capacity' })
  let closed = false; const closing = db.close().then(() => { closed = true })
  await assert.rejects(db.execute('SELECT 1'), { code: 'closed' })
  await sleep(5); assert.equal(closed, false); assert.equal(db.stats().pending, 2)
  release.resolve(); await Promise.all([tx, accepted, closing]); assert.equal(db.stats().closed, true)
})

test('joined publication drains and caught participant failures poison commit', async () => {
  const db = await database(), entered = deferred(), release = deferred()
  await db.execute('CREATE TABLE entries(v TEXT)')
  let committed = false
  const pending = db.transaction(async tx => {
    void participateInTransaction(tx, async descendant => { entered.resolve(); await release.promise; await descendant.execute("INSERT INTO entries VALUES('joined')") })
  }).then(() => { committed = true })
  await entered.promise; await sleep(5); assert.equal(committed, false); release.resolve(); await pending
  const failure = new Error('publisher failed')
  await assert.rejects(db.transaction(async tx => {
    await tx.execute("INSERT INTO entries VALUES('rollback')")
    await participateInTransaction(tx, async () => { throw failure }).catch(() => {})
  }), error => error === failure)
  assert.deepEqual((await db.execute('SELECT * FROM entries')).rows, [{ v: 'joined' }])
})

test('result rejection leaves the connection usable and preserves autocommit ambiguity', async () => {
  const db = await database({ maxResultBytes: 40, maxResultRows: 1 })
  await db.execute('CREATE TABLE entries(v TEXT)')
  await assert.rejects(db.execute({ sql: 'INSERT INTO entries VALUES(?) RETURNING v', args: ['x'.repeat(50)] }), { code: 'result-limit' })
  assert.equal((await db.execute('SELECT count(*) AS n FROM entries')).rows[0].n, 1n)
  await assert.rejects(db.transaction(async tx => { await tx.execute({ sql: 'INSERT INTO entries VALUES(?) RETURNING v', args: ['y'.repeat(50)] }) }), { code: 'result-limit' })
  assert.equal((await db.execute('SELECT count(*) AS n FROM entries')).rows[0].n, 1n)
  await assert.rejects(db.execute('SELECT 1 UNION ALL SELECT 2'), { code: 'result-limit' })
  assert.equal((await db.execute('SELECT 2 AS n')).rows[0].n, 2n)
})

test('input budgets and native failures expose no SQL/value diagnostics', async () => {
  for (const options of [{ filename: '' }, { busyTimeoutMs: -1 }, { maxPending: 0 }, { maxSqlBytes: 0 }, { maxResultRows: Infinity }]) {
    await assert.rejects(openSqlite({ filename: ':memory:', ...options }), { code: 'input' })
  }
  const db = await database({ maxSqlBytes: 100, maxInputBytes: 100 })
  await assert.rejects(db.execute({ sql: 'SELECT ?', args: ['é'.repeat(50)] }), { code: 'input' })
  await assert.rejects(db.execute({ sql: 'SELECT ?', args: Array(1001).fill(1) }), { code: 'input' })
  await assert.rejects(db.execute('SELECT secret_password FROM missing_secret_table'), /^DenoSqliteError: Deno SQLite operation failed: storage$/)
})

test('concurrent migrations persist exact history and int64 state through reopen', async () => {
  const file = await filename(), first = await database({ filename: file }), second = await database({ filename: file })
  const manifest = [{ id: '001_entries', statements: ['CREATE TABLE entries(id INTEGER PRIMARY KEY)'] }]
  await Promise.all([migrate(first, manifest), migrate(second, manifest)])
  await first.execute('INSERT INTO entries VALUES(9223372036854775807)'); await first.close(); await second.close()
  const reopened = await database({ filename: file }); await migrate(reopened, manifest)
  assert.deepEqual((await reopened.execute('SELECT * FROM entries')).rows, [{ id: 9223372036854775807n }])
  assert.equal((await reopened.execute('SELECT count(*) AS n FROM longhorn_migrations')).rows[0].n, 1n)
  assert.equal((await reopened.execute('PRAGMA integrity_check')).rows[0].integrity_check, 'ok')
})

test('unchanged SQL queue, scheduler and replay stores use managed native transactions', async () => {
  const db = await database()
  await migrate(db, [...queueMigrations, ...schedulerMigrations, ...idempotencyMigrations, { id: 'business/001_entries', statements: ['CREATE TABLE entries(v TEXT)'] }])
  const schema = { '~standard': { version: 1, vendor: 'fixture', validate: async value => {
    await sleep(1); return typeof value?.title === 'string' ? { value } : { issues: [{ message: 'Title required' }] }
  } } }
  const queue = new Queue({ name: 'deno.v1', store: new SqliteQueueStore(db), schema, now: () => 1000 })
  const scheduler = new Scheduler({ store: new SqliteSchedulerStore(db), now: () => 1000 }); resources.push(queue, scheduler)
  await db.transaction(async tx => { await tx.execute("INSERT INTO entries VALUES('business')"); void enqueueInTransaction(queue, tx, { title: 'joined' }) })
  await assert.rejects(db.transaction(async tx => { await tx.execute("INSERT INTO entries VALUES('rolled back')"); await enqueueInTransaction(queue, tx, {}).catch(() => {}) }))
  await scheduler.at(queue, { title: 'scheduled' }, { id: 'once', at: 1000 }); assert.equal((await scheduler.tick()).dispatched.length, 1)
  const consumed = []
  for (let i = 0; i < 2; i++) assert.equal((await queue.runOnce(data => { consumed.push(data.title) })).status, 'succeeded')
  assert.deepEqual(consumed.sort(), ['joined', 'scheduled'])
  const idempotency = new Idempotency({ store: new SqliteIdempotencyStore(db), now: () => 1000 }); let calls = 0
  const request = { scope: 'entries:v1', key: 'one', input: { title: 'request' } }
  const work = async tx => { calls++; await tx.execute("INSERT INTO entries VALUES('request')"); return { saved: true } }
  assert.equal((await idempotency.run(request, work)).replayed, false); assert.equal((await idempotency.run(request, work)).replayed, true)
  assert.equal(calls, 1); assert.deepEqual((await db.execute('SELECT v FROM entries ORDER BY v')).rows, [{ v: 'business' }, { v: 'request' }])
})
