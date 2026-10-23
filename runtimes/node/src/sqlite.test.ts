import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { migrate } from '@longhorn/database'
import type { Database, SqlExecutor } from '@longhorn/database'
import { openSqlite } from './sqlite.js'

const databases: Database[] = []
const directories: string[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function open(filename = ':memory:'): Promise<Database> {
  const database = await openSqlite({ filename, busyTimeoutMs: 0 })
  databases.push(database)
  return database
}

async function filename(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'longhorn-sqlite-'))
  directories.push(directory)
  return join(directory, 'nested', 'tasks.sqlite')
}

it('preserves SQL values and binds parameters without executing their content', async () => {
  const database = await open()
  const text = "x'); DROP TABLE items; --"
  const result = await database.execute({
    sql: 'SELECT ? AS text, ? AS integer, ? AS decimal, ? AS empty, ? AS blob',
    args: [text, 9007199254740993n, 1.5, null, new Uint8Array([1, 2, 3])],
  })
  expect(result.rows[0]).toEqual({ text, integer: 9007199254740993n, decimal: 1.5, empty: null, blob: new Uint8Array([1, 2, 3]) })
})

it('exposes its dialect and maps portable boolean parameters to SQLite integers', async () => {
  const database = await open()
  expect(database.dialect).toBe('sqlite')
  expect((await database.execute({ sql: 'SELECT ? AS yes, ? AS no', args: [true, false] })).rows[0]).toEqual({ yes: 1n, no: 0n })
})

it('persists committed rows after closing and reopening a local file', async () => {
  const path = await filename()
  const first = await open(path)
  await first.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
  await first.execute({ sql: 'INSERT INTO items (name) VALUES (?)', args: ['persisted'] })
  await first.close()
  const second = await open(path)
  expect((await second.execute('SELECT id, name FROM items')).rows).toEqual([{ id: 1n, name: 'persisted' }])
})

it('commits successful transactions and rolls back failed work', async () => {
  const database = await open()
  await database.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT UNIQUE)')
  const result = await database.transaction(async (tx) => {
    await tx.execute({ sql: 'INSERT INTO items (name) VALUES (?)', args: ['first'] })
    return 'committed'
  })
  expect(result).toBe('committed')
  await expect(database.transaction(async (tx) => {
    await tx.execute({ sql: 'INSERT INTO items (name) VALUES (?)', args: ['second'] })
    await tx.execute({ sql: 'INSERT INTO items (name) VALUES (?)', args: ['first'] })
  })).rejects.toThrow()
  expect((await database.execute('SELECT name FROM items')).rows).toEqual([{ name: 'first' }])
})

it('serializes transactions across handles for the same file', async () => {
  const path = await filename()
  const a = await open(path)
  const b = await open(path)
  await a.execute('CREATE TABLE counter (value INTEGER NOT NULL)')
  await a.execute('INSERT INTO counter VALUES (0)')
  await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? a : b).transaction(async (tx) => {
    const value = (await tx.execute('SELECT value FROM counter')).rows[0]!.value as bigint
    await Promise.resolve()
    await tx.execute({ sql: 'UPDATE counter SET value = ?', args: [value + 1n] })
  })))
  expect((await a.execute('SELECT value FROM counter')).rows).toEqual([{ value: 20n }])
})

it('rejects parent database calls within a transaction instead of deadlocking', async () => {
  const database = await open()
  await expect(database.transaction(async () => { await database.execute('SELECT 1') }))
    .rejects.toThrow(/transaction executor/)
  await expect(database.transaction(async () => { await database.close() }))
    .rejects.toThrow(/inside its transaction/)
  expect((await database.execute('SELECT 1 AS value')).rows[0]?.value).toBe(1n)
})

it('rejects a transaction executor after its callback finishes', async () => {
  const database = await open()
  let executor: SqlExecutor | undefined
  await database.transaction(async (tx) => { executor = tx })
  await expect(executor!.execute('SELECT 1')).rejects.toThrow('Transaction is closed')
})

it('expires transaction context for work scheduled after a successful callback', async () => {
  const database = await open()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  let later: Promise<unknown> | undefined
  await database.transaction(async () => {
    later = gate.then(() => database.execute('SELECT 1'))
  })
  release()
  await expect(later).resolves.toHaveProperty('rows')
})

it('enforces foreign keys inside transactions', async () => {
  const database = await open()
  await database.execute('CREATE TABLE parent (id INTEGER PRIMARY KEY)')
  await database.execute('CREATE TABLE child (parent_id INTEGER REFERENCES parent(id))')
  await expect(database.transaction(async (tx) => {
    await tx.execute('INSERT INTO child VALUES (999)')
  })).rejects.toThrow()
  expect((await database.execute('SELECT * FROM child')).rows).toEqual([])
})

it('waits for accepted operations and rejects new work when closing', async () => {
  const database = await open()
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => { enter = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const transaction = database.transaction(async (tx) => {
    enter()
    await gate
    return tx.execute('SELECT 42 AS value')
  })
  await entered
  const queued = database.execute('SELECT 43 AS value')
  const closing = database.close()
  expect(database.close()).toBe(closing)
  await expect(database.execute('SELECT 44')).rejects.toThrow(/closing or closed/)
  release()
  expect((await transaction).rows[0]?.value).toBe(42n)
  expect((await queued).rows[0]?.value).toBe(43n)
  await closing
})

it('applies migrations once and permits concurrent startup on one file', async () => {
  const path = await filename()
  const a = await open(path)
  const b = await open(path)
  const migrations = [{ id: '001_items', statements: ['CREATE TABLE items (name TEXT)'] }]
  const applied = await Promise.all([migrate(a, migrations), migrate(b, migrations)])
  expect(applied.flat()).toEqual(['001_items'])
  expect(await migrate(a, migrations)).toEqual([])
})

it('rejects changed or missing applied migrations', async () => {
  const database = await open()
  const migrations = [{ id: '001_items', statements: ['CREATE TABLE items (name TEXT)'] }]
  await migrate(database, migrations)
  await expect(migrate(database, [{ id: '001_items', statements: ['CREATE TABLE items (name TEXT NOT NULL)'] }]))
    .rejects.toThrow('Applied migration changed')
  await expect(migrate(database, [])).rejects.toThrow(/unavailable/)
  await expect(migrate(database, [{ id: 'new_first', statements: [] }, ...migrations])).rejects.toThrow(/ordered prefix/)
})

it('rolls back all pending migration statements and metadata on failure', async () => {
  const database = await open()
  await expect(migrate(database, [
    { id: '001_items', statements: ['CREATE TABLE items (name TEXT)'] },
    { id: '002_failure', statements: ['INSERT INTO nonexistent VALUES (1)'] },
  ])).rejects.toThrow()
  expect((await database.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows).toEqual([])
})

it('rejects duplicate migration IDs before making schema changes', async () => {
  const database = await open()
  await expect(migrate(database, [{ id: 'same', statements: [] }, { id: 'same', statements: [] }]))
    .rejects.toThrow(/unique/)
  expect((await database.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows).toEqual([])
})
