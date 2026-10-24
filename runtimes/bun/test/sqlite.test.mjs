import { afterEach, expect, test } from 'bun:test'
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

// Run only with the native Bun executable, against the shipped provider entrypoint.
const resources = [], directories = []
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function database(options = {}) { const db = await openSqlite({ filename: ':memory:', ...options }); resources.push(db); return db }
async function filename() { const directory = await mkdtemp(join(tmpdir(), 'longhorn bun sqlite ')); directories.push(directory); return join(directory, 'data #1.sqlite') }
afterEach(async () => {
  const failures = []
  for (const value of resources.splice(0).reverse()) try { await value.close() } catch (error) { failures.push(error) }
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  if (failures.length) throw new AggregateError(failures, 'Native Bun test cleanup failed')
})

test('native values retain int64, float, boolean, null and copied blob bindings/results', async () => {
  const db = await database()
  const row = (await db.execute({ sql: 'SELECT ? AS id, ? AS real, ? AS yes, ? AS no, ? AS empty_value, ? AS body, ? AS text', args: [9223372036854775807n, 1.25, true, false, null, new Uint8Array([0, 255]), '😀'] })).rows[0]
  expect(row).toEqual({ id: 9223372036854775807n, real: 1.25, yes: 1n, no: 0n, empty_value: null, body: new Uint8Array([0, 255]), text: '😀' })
  for (const value of [NaN, Infinity, 9007199254740992, 9223372036854775808n, -(2n ** 63n) - 1n, '\uD800', undefined]) {
    await expect(db.execute({ sql: 'SELECT ?', args: [value] })).rejects.toMatchObject({ code: 'input' })
  }
})

test('snapshots SQL, argument arrays and blobs before queued admission', async () => {
  const db = await database(), entered = deferred(), release = deferred()
  const tx = db.transaction(async () => { entered.resolve(); await release.promise })
  await entered.promise
  const bytes = new Uint8Array([1, 2]), args = [bytes], query = { sql: 'SELECT ? AS body', args }
  const read = db.execute(query)
  query.sql = 'SELECT 99'; args[0] = 'changed'; bytes[0] = 9
  release.resolve(); await tx
  expect((await read).rows[0].body).toEqual(new Uint8Array([1, 2]))
})

test('metadata reports direct changes, excludes trigger rows and avoids stale SELECT counts', async () => {
  const db = await database()
  await db.execute('CREATE TABLE source(id INTEGER PRIMARY KEY, v TEXT)')
  await db.execute('CREATE TABLE audit(v TEXT)')
  await db.execute("CREATE TRIGGER record AFTER INSERT ON source BEGIN INSERT INTO audit VALUES(CASE WHEN NEW.v='one' THEN 'yes' ELSE 'no' END); INSERT INTO audit VALUES('again'); END;")
  const inserted = await db.execute("INSERT INTO source(v) VALUES('one') RETURNING id")
  expect(inserted.rowsAffected).toBe(1); expect(inserted.lastInsertId).toBe(1n)
  expect((await db.execute('SELECT * FROM audit')).rows).toHaveLength(2)
  expect((await db.execute('SELECT * FROM source')).rowsAffected).toBe(0)
  expect((await db.execute("UPDATE source SET v='two'")).rowsAffected).toBe(1)
  expect((await db.execute('DELETE FROM source WHERE id=99')).rowsAffected).toBe(0)
})

test('rejects trailing SQL and manual transaction controls before any SQL effect', async () => {
  const db = await database()
  await db.execute('CREATE TABLE source(v TEXT)')
  for (const sql of ["INSERT INTO source VALUES('secret'); SELECT 1", '/*comment*/ BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT x', 'RELEASE x', 'END', 'SELECT 1; /* c */ SELECT 2', '/* unclosed', "SELECT 'unclosed"]) {
    await expect(db.execute(sql)).rejects.toMatchObject({ code: 'input' })
  }
  expect((await db.execute('SELECT * FROM source')).rows).toHaveLength(0)
  expect((await db.execute("SELECT ';' AS semi /* ; */; -- tail")).rows[0].semi).toBe(';')
  for (const args of [[], [1, 2]]) await expect(db.execute({ sql: 'INSERT INTO source VALUES(?)', args })).rejects.toMatchObject({ code: 'input' })
  expect((await db.execute('SELECT * FROM source')).rows).toHaveLength(0)
})

test('async callback holds a real transaction, rolls back DDL and expires its executor', async () => {
  const db = await database(); let expired
  const failure = new Error('business failure')
  await expect(db.transaction(async tx => {
    expired = tx; assertTransactionExecutor(tx, db)
    await tx.execute('CREATE TABLE temporary(v TEXT)')
    await Bun.sleep(1); await tx.execute("INSERT INTO temporary VALUES('lost')")
    throw failure
  })).rejects.toBe(failure)
  await expect(db.execute('SELECT * FROM temporary')).rejects.toMatchObject({ code: 'storage' })
  await expect(expired.execute('SELECT 1')).rejects.toThrow('closed')
  await db.execute('CREATE TABLE temporary(v TEXT)')
  expect(await db.transaction(async tx => { await tx.execute("INSERT INTO temporary VALUES('saved')"); await Bun.sleep(1); return 'result' })).toBe('result')
  expect((await db.execute('SELECT v FROM temporary')).rows).toEqual([{ v: 'saved' }])
})

test('native automatic rollback cannot turn caught failure and later SQL into autocommit', async () => {
  const db = await database()
  await db.execute('CREATE TABLE unique_values(id INTEGER PRIMARY KEY)')
  await db.execute('INSERT INTO unique_values VALUES(1)')
  await expect(db.transaction(async tx => {
    await tx.execute('INSERT INTO unique_values VALUES(2)')
    await expect(tx.execute('INSERT OR ROLLBACK INTO unique_values VALUES(1)')).rejects.toMatchObject({ code: 'storage' })
    await expect(tx.execute('INSERT INTO unique_values VALUES(3)')).rejects.toMatchObject({ code: 'transaction' })
  })).rejects.toMatchObject({ code: 'transaction' })
  expect((await db.execute('SELECT id FROM unique_values')).rows).toEqual([{ id: 1n }])
  await db.transaction(async tx => { await tx.execute('INSERT INTO unique_values VALUES(4)') })
})

test('same-file handles and symlinks serialize async ownership and reject callback reentrancy', async () => {
  const file = await filename(), first = await database({ filename: file })
  const alias = file + '.alias'; await symlink(file, alias)
  const second = await database({ filename: alias })
  await first.execute('CREATE TABLE entries(v INTEGER)')
  const entered = deferred(), release = deferred()
  const tx = first.transaction(async executor => {
    await executor.execute('INSERT INTO entries VALUES(1)')
    for (const handle of [first, second]) {
      await expect(handle.execute('SELECT 1')).rejects.toMatchObject({ code: 'transaction' })
      await expect(handle.transaction(async () => {})).rejects.toMatchObject({ code: 'transaction' })
      await expect(handle.close()).rejects.toMatchObject({ code: 'transaction' })
    }
    await expect(openSqlite({ filename: alias })).rejects.toMatchObject({ code: 'transaction' })
    entered.resolve(); await release.promise
  })
  await entered.promise
  let returned = false
  const read = second.execute('SELECT * FROM entries').then(value => { returned = true; return value })
  await Bun.sleep(5); expect(returned).toBe(false)
  release.resolve(); await tx
  expect((await read).rows).toEqual([{ v: 1n }])
})

test('admission is bounded and close drains accepted work before releasing the connection', async () => {
  const db = await database({ maxPending: 2 }), entered = deferred(), release = deferred()
  const tx = db.transaction(async executor => { entered.resolve(); await release.promise; await executor.execute('CREATE TABLE after_wait(v TEXT)') })
  await entered.promise
  const accepted = db.execute('SELECT * FROM after_wait')
  await expect(db.execute('SELECT 1')).rejects.toMatchObject({ code: 'capacity' })
  let closed = false
  const closing = db.close().then(() => { closed = true })
  await expect(db.execute('SELECT 1')).rejects.toMatchObject({ code: 'closed' })
  await Bun.sleep(5); expect(closed).toBe(false); expect(db.stats().pending).toBe(2)
  release.resolve(); await Promise.all([tx, accepted, closing])
  expect(db.stats()).toMatchObject({ pending: 0, closed: true })
})

test('joined participants drain before commit and a caught participant failure poisons commit', async () => {
  const db = await database(), entered = deferred(), release = deferred()
  await db.execute('CREATE TABLE entries(v TEXT)')
  let committed = false
  const pending = db.transaction(async tx => {
    void participateInTransaction(tx, async descendant => { entered.resolve(); await release.promise; await descendant.execute("INSERT INTO entries VALUES('joined')") })
  }).then(() => { committed = true })
  await entered.promise; await Bun.sleep(5); expect(committed).toBe(false)
  release.resolve(); await pending
  const failure = new Error('publisher failed')
  await expect(db.transaction(async tx => {
    await tx.execute("INSERT INTO entries VALUES('rollback')")
    await participateInTransaction(tx, async () => { throw failure }).catch(() => {})
  })).rejects.toBe(failure)
  expect((await db.execute('SELECT * FROM entries')).rows).toEqual([{ v: 'joined' }])
})

test('result limits after an autocommit can reject a committed write; uncaught callback failure rolls back', async () => {
  const db = await database({ maxResultBytes: 40, maxResultRows: 1 })
  await db.execute('CREATE TABLE entries(v TEXT)')
  await expect(db.execute({ sql: 'INSERT INTO entries VALUES(?) RETURNING v', args: ['x'.repeat(50)] })).rejects.toMatchObject({ code: 'result-limit' })
  expect((await db.execute('SELECT count(*) AS n FROM entries')).rows[0].n).toBe(1n)
  await expect(db.transaction(async tx => { await tx.execute({ sql: 'INSERT INTO entries VALUES(?) RETURNING v', args: ['y'.repeat(50)] }) })).rejects.toMatchObject({ code: 'result-limit' })
  expect((await db.execute('SELECT count(*) AS n FROM entries')).rows[0].n).toBe(1n)
  await expect(db.execute('SELECT 1 UNION ALL SELECT 2')).rejects.toMatchObject({ code: 'result-limit' })
})

test('input byte/count options are enforced and native diagnostics do not echo SQL or values', async () => {
  for (const options of [{ filename: '' }, { busyTimeoutMs: -1 }, { maxPending: 0 }, { maxSqlBytes: 0 }, { maxResultRows: Infinity }]) {
    await expect(openSqlite({ filename: ':memory:', ...options })).rejects.toMatchObject({ code: 'input' })
  }
  const db = await database({ maxSqlBytes: 100, maxInputBytes: 100 })
  await expect(db.execute({ sql: 'SELECT ?', args: ['é'.repeat(50)] })).rejects.toMatchObject({ code: 'input' })
  await expect(db.execute({ sql: 'SELECT ?', args: Array(1001).fill(1) })).rejects.toMatchObject({ code: 'input' })
  await expect(db.execute('SELECT secret_password FROM missing_secret_table')).rejects.toThrow(/^Bun SQLite operation failed: storage$/)
})

test('concurrent migration handles serialize and persist exact history through reopen', async () => {
  const file = await filename(), first = await database({ filename: file }), second = await database({ filename: file })
  const manifest = [{ id: '001_entries', statements: ['CREATE TABLE entries(id INTEGER PRIMARY KEY)'] }]
  await Promise.all([migrate(first, manifest), migrate(second, manifest)])
  await first.execute('INSERT INTO entries VALUES(9223372036854775807)')
  await first.close(); await second.close()
  const reopened = await database({ filename: file })
  await migrate(reopened, manifest)
  expect((await reopened.execute('SELECT * FROM entries')).rows).toEqual([{ id: 9223372036854775807n }])
  expect((await reopened.execute('SELECT count(*) AS n FROM longhorn_migrations')).rows[0].n).toBe(1n)
  expect((await reopened.execute('PRAGMA integrity_check')).rows[0].integrity_check).toBe('ok')
})

test('existing queue publication, scheduler dispatch and callback replay use unchanged SQL stores', async () => {
  const db = await database()
  await migrate(db, [...queueMigrations, ...schedulerMigrations, ...idempotencyMigrations, { id: 'business/001_entries', statements: ['CREATE TABLE entries(v TEXT)'] }])
  const schema = { '~standard': { version: 1, vendor: 'fixture', validate: async value => {
    await Bun.sleep(1)
    return typeof value?.title === 'string' ? { value } : { issues: [{ message: 'Title required' }] }
  } } }
  const queue = new Queue({ name: 'bun.v1', store: new SqliteQueueStore(db), schema, now: () => 1000 })
  const scheduler = new Scheduler({ store: new SqliteSchedulerStore(db), now: () => 1000 })
  resources.push(queue, scheduler)
  await db.transaction(async tx => {
    await tx.execute("INSERT INTO entries VALUES('business')")
    void enqueueInTransaction(queue, tx, { title: 'joined' })
  })
  await expect(db.transaction(async tx => {
    await tx.execute("INSERT INTO entries VALUES('rolled back')")
    await enqueueInTransaction(queue, tx, {}).catch(() => {})
  })).rejects.toThrow()
  await scheduler.at(queue, { title: 'scheduled' }, { id: 'once', at: 1000 })
  expect((await scheduler.tick()).dispatched).toHaveLength(1)
  const consumed = []
  expect((await queue.runOnce(data => { consumed.push(data.title) })).status).toBe('succeeded')
  expect((await queue.runOnce(data => { consumed.push(data.title) })).status).toBe('succeeded')
  expect(consumed.sort()).toEqual(['joined', 'scheduled'])
  const idempotency = new Idempotency({ store: new SqliteIdempotencyStore(db), now: () => 1000 })
  let calls = 0
  const request = { scope: 'entries:v1', key: 'one', input: { title: 'request' } }
  const work = async tx => { calls++; await tx.execute("INSERT INTO entries VALUES('request')"); return { saved: true } }
  expect((await idempotency.run(request, work)).replayed).toBe(false)
  expect((await idempotency.run(request, work)).replayed).toBe(true)
  expect(calls).toBe(1)
  expect((await db.execute('SELECT v FROM entries ORDER BY v')).rows).toEqual([{ v: 'business' }, { v: 'request' }])
})
