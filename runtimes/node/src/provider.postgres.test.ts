import { afterEach, expect, it } from 'vitest'
import { migratePostgres } from '@longhornjs/database/postgres'
import type { SqlExecutor } from '@longhornjs/database'
import { openPostgres, PostgresCapacityError, PostgresClosedError, PostgresTransactionAbortedError } from './postgres.js'
import type { PostgresDatabase, PostgresOptions } from './postgres.js'
const connectionString = process.env.LONGHORN_PG_TEST_URL
if (process.env.LONGHORN_PG_TEST_OWNED !== 'true' || !connectionString) throw new Error('Use pnpm test:postgres; it owns an isolated native cluster')
const databases: PostgresDatabase[] = []
afterEach(async () => { for (const database of databases.splice(0)) await database.close() })
async function open(options: Partial<PostgresOptions> = {}) { const db = await openPostgres({ connectionString: connectionString!, ...options }); databases.push(db); return db }
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done }); return { resolve, promise } }
async function table(db: PostgresDatabase, name: string) {
  await db.execute('CREATE SCHEMA IF NOT EXISTS provider_qa')
  await db.execute('CREATE TABLE provider_qa.' + name + ' (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text NOT NULL UNIQUE)')
}
it('preserves exact native scalar types, JSON/time/array text and binds hostile text as data', async () => {
  const db = await open(), hostile = "x'); DROP SCHEMA provider_qa CASCADE; --"
  const row = (await db.execute({ sql: 'SELECT $1::text AS text, $2::int8 AS large, $3::boolean AS yes, $4::bytea AS bytes, 12345678901234567890.123456::numeric AS exact, \'{"value":9007199254740993}\'::jsonb AS json, \'2026-10-23 01:02:03.123456+00\'::timestamptz AS at, ARRAY[1,2]::int[] AS items',
    args: [hostile, 9007199254740993n, true, new Uint8Array([1, 2, 3])] })).rows[0]!
  expect(row).toMatchObject({ text: hostile, large: 9007199254740993n, yes: true, bytes: new Uint8Array([1, 2, 3]), exact: '12345678901234567890.123456', items: '{1,2}' })
  expect(row.json).toBe('{"value": 9007199254740993}')
  expect(row.at).toBe('2026-10-23 01:02:03.123456+00')
  expect(db.dialect).toBe('postgres')
})
it('uses one transaction connection, commits returning rows and rolls back callback errors', async () => {
  const db = await open(); await table(db, 'transactions')
  const output = await db.transaction(async (tx) => {
    expect(tx.dialect).toBe('postgres')
    return (await tx.execute({ sql: 'INSERT INTO provider_qa.transactions(value) VALUES($1) RETURNING id', args: ['committed'] })).rows[0]!.id
  })
  expect(output).toBe(1n)
  const failure = new Error('business failure')
  await expect(db.transaction(async (tx) => { await tx.execute("INSERT INTO provider_qa.transactions(value) VALUES('rolled-back')"); throw failure })).rejects.toBe(failure)
  expect((await db.execute('SELECT value FROM provider_qa.transactions')).rows).toEqual([{ value: 'committed' }])
})
it('rolls back even when a callback catches a server error, and drains unawaited accepted statements', async () => {
  const db = await open(); await table(db, 'sticky')
  await expect(db.transaction(async (tx) => {
    await tx.execute("INSERT INTO provider_qa.sticky(value) VALUES('one')")
    try { await tx.execute("INSERT INTO provider_qa.sticky(value) VALUES('one')") } catch { /* Deliberate caller suppression. */ }
    return 'must not commit'
  })).rejects.toBeInstanceOf(PostgresTransactionAbortedError)
  expect((await db.execute('SELECT value FROM provider_qa.sticky')).rows).toEqual([])
  await db.transaction(async (tx) => { void tx.execute("INSERT INTO provider_qa.sticky(value) VALUES('accepted')") })
  expect((await db.execute('SELECT value FROM provider_qa.sticky')).rows).toEqual([{ value: 'accepted' }])
})
it('rejects reentrant parent calls and expired executors without inheriting a finished transaction into later work', async () => {
  const db = await open({ maxConnections: 1 })
  let executor!: SqlExecutor, later!: Promise<unknown>
  const release = deferred()
  await db.transaction(async (tx) => {
    executor = tx
    await expect(db.execute('SELECT 1')).rejects.toThrow('executor')
    await expect(db.transaction(async () => {})).rejects.toThrow('executor')
    await expect(db.close()).rejects.toThrow('inside')
    later = release.promise.then(() => db.execute('SELECT 1'))
  })
  await expect(executor.execute('SELECT 1')).rejects.toThrow('closed')
  release.resolve(); await expect(later).resolves.toHaveProperty('rows')
})
it('bounds admitted operations and drains a held transaction before pool shutdown', async () => {
  const db = await open({ maxConnections: 1, maxPending: 1 }), entered = deferred(), release = deferred()
  const pending = db.transaction(async (tx) => { await tx.execute('SELECT 1'); entered.resolve(); await release.promise })
  await entered.promise
  await expect(db.execute('SELECT 1')).rejects.toBeInstanceOf(PostgresCapacityError)
  const closing = db.close(); expect(db.close()).toBe(closing)
  await expect(db.execute('SELECT 1')).rejects.toBeInstanceOf(PostgresClosedError)
  expect(db.stats()).toMatchObject({ closing: true, closed: false, active: 1 })
  release.resolve(); await pending; await closing
  expect(db.stats()).toMatchObject({ closed: true, active: 0, total: 0 })
})
it('releases admission capacity before resolving a completed caller', async () => {
  const db = await open({ maxConnections: 1, maxPending: 1 })
  for (let value = 0; value < 4; value++) expect((await db.execute({ sql: 'SELECT $1::integer AS value', args: [value] })).rows[0]!.value).toBe(value)
  expect(db.stats().active).toBe(0)
})
it('snapshots byte parameters before a queued pool checkout', async () => {
  const db = await open({ maxConnections: 1 }), entered = deferred(), release = deferred()
  const held = db.transaction(async () => { entered.resolve(); await release.promise })
  await entered.promise
  const bytes = new Uint8Array([1, 2]), pending = db.execute({ sql: 'SELECT $1::bytea AS bytes', args: [bytes] })
  bytes[0] = 99; release.resolve(); await held
  expect((await pending).rows[0]!.bytes).toEqual(new Uint8Array([1, 2]))
})
it('clears session state/temp tables and re-establishes owned settings on the next lease', async () => {
  const db = await open({ maxConnections: 1 })
  await db.execute('SET search_path TO public')
  expect((await db.execute('SHOW search_path')).rows[0]!.search_path).toBe('pg_catalog')
  await db.transaction(async (tx) => {
    await tx.execute('CREATE TEMP TABLE temporary_test(value integer)')
    await tx.execute('INSERT INTO temporary_test VALUES(1)')
    expect((await tx.execute('SELECT value FROM temporary_test')).rows[0]!.value).toBe(1)
  })
  expect((await db.execute("SELECT pg_catalog.to_regclass('pg_temp.temporary_test') AS table_name")).rows[0]!.table_name).toBeNull()
})
it('enforces server-side statement deadlines and recovers after cancellation', async () => {
  const db = await open({ statementTimeoutMs: 30 })
  await expect(db.execute('SELECT pg_catalog.pg_sleep(0.15)')).rejects.toMatchObject({ code: '57014' })
  expect((await db.execute('SELECT 1 AS ready')).rows[0]!.ready).toBe(1)
})
it('handles checked-out connection loss without an unhandled client error and reconnects on later work', async () => {
  const db = await open(), killer = await open(), entered = deferred(), release = deferred()
  let pid!: number
  const pending = db.transaction(async (tx) => { pid = (await tx.execute('SELECT pg_catalog.pg_backend_pid() AS pid')).rows[0]!.pid as number; entered.resolve(); await release.promise })
  const observed = pending.catch((error: unknown) => error)
  await entered.promise
  await killer.execute({ sql: 'SELECT pg_catalog.pg_terminate_backend($1::integer)', args: [pid] })
  await new Promise((resolve) => setTimeout(resolve, 20)); release.resolve()
  expect(await observed).toBeInstanceOf(Error)
  expect(db.stats().connectionErrors).toBeGreaterThan(0)
  expect((await db.execute('SELECT 1 AS ready')).rows[0]!.ready).toBe(1)
})
it('rejects direct transaction commands and multi-statement scripts without rewriting question marks', async () => {
  const db = await open()
  for (const sql of ['BEGIN', '; /* outer /* nested */ x */ ; COMMIT', '-- comment\nROLLBACK', 'START TRANSACTION', 'SAVEPOINT manual']) await expect(db.execute(sql)).rejects.toThrow('transaction')
  await db.transaction(async (tx) => {
    await expect(tx.execute('; -- empty command\nCOMMIT')).rejects.toThrow('transaction')
    expect((await tx.execute('SELECT 1 AS active')).rows[0]!.active).toBe(1)
  })
  await expect(db.execute('SELECT 1; SELECT 2')).rejects.toMatchObject({ code: '42601' })
  await expect(db.execute({ sql: 'SELECT ? AS invalid', args: [1] })).rejects.toThrow()
  expect((await db.execute("SELECT 'literal ?'::text AS value")).rows[0]!.value).toBe('literal ?')
})
it('serializes concurrent initial migrations, checks immutable histories and rolls back failed DDL', async () => {
  const a = await open(), b = await open()
  const migrations = [{ id: 'first', statements: ['CREATE TABLE migration_qa.items(id bigint PRIMARY KEY)'] }]
  const added = await Promise.all([migratePostgres(a, migrations, { schema: 'migration_qa' }), migratePostgres(b, migrations, { schema: 'migration_qa' })])
  expect(added.flat()).toEqual(['first'])
  await expect(migratePostgres(a, [{ id: 'first', statements: ['SELECT 1'] }], { schema: 'migration_qa' })).rejects.toThrow('changed')
  await expect(migratePostgres(a, [], { schema: 'migration_qa' })).rejects.toThrow('unavailable')
  await expect(migratePostgres(a, [...migrations, { id: 'bad', statements: ['CREATE TABLE migration_qa.rolled_back(id integer)', 'SELECT missing_column'] }], { schema: 'migration_qa' })).rejects.toThrow()
  expect((await a.execute("SELECT pg_catalog.to_regclass('migration_qa.rolled_back') AS name")).rows[0]!.name).toBeNull()
  expect((await a.execute('SELECT count(*) AS count FROM migration_qa.longhorn_migrations')).rows[0]!.count).toBe(1n)
})
