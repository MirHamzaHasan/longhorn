import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdir, realpath } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@libsql/client/sqlite3'
import type { InStatement, ResultSet } from '@libsql/client/sqlite3'
import type { Database, QueryResult, SqlExecutor, SqlStatement, SqlValue } from '@longhornjs/database'
import { createTransactionScope } from '@longhornjs/database/transactions'

export type SqliteOptions = { filename: string; busyTimeoutMs?: number }
type Gate = { tail: Promise<void>; references: number }
type HeldTransaction = { gate: Gate; active: boolean }
const files = new Map<string, Gate>()
const heldTransactions = new AsyncLocalStorage<ReadonlySet<HeldTransaction>>()

function statement(input: SqlStatement): InStatement {
  return typeof input === 'string' ? input : { sql: input.sql, args: (input.args ?? []).map((value) => typeof value === 'boolean' ? value ? 1n : 0n : value) }
}

function value(input: unknown): SqlValue {
  if (input === null || typeof input === 'string' || typeof input === 'number' || typeof input === 'bigint') return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (input instanceof Uint8Array) return new Uint8Array(input)
  throw new Error('Database returned an unsupported SQL value')
}

function result(input: ResultSet): QueryResult {
  return {
    rows: input.rows.map((row) => Object.fromEntries(input.columns.map((column, index) => [column, value(row[index])]))),
    rowsAffected: input.rowsAffected,
    lastInsertId: input.lastInsertRowid,
  }
}

/** Local SQLite only. Native driver and filesystem access stay in this runtime entrypoint. */
export async function openSqlite(options: SqliteOptions): Promise<Database> {
  if (!options.filename.trim()) throw new Error('SQLite filename must not be empty')
  const timeout = options.busyTimeoutMs ?? 5000
  if (!Number.isSafeInteger(timeout) || timeout < 0) throw new Error('SQLite busy timeout must be a nonnegative integer')
  const memory = options.filename === ':memory:'
  const filename = resolve(options.filename)
  if (!memory) await mkdir(dirname(filename), { recursive: true })
  const client = createClient({
    url: memory ? 'file::memory:' : pathToFileURL(filename).href,
    intMode: 'bigint', concurrency: 1,
  })
  let key: string | undefined
  try { key = memory ? undefined : await realpath(filename) } catch (error) { client.close(); throw error }
  const gate = (key ? files.get(key) : undefined) ?? { tail: Promise.resolve(), references: 0 }
  gate.references++
  if (key) files.set(key, gate)
  let closing: Promise<void> | undefined

  function reentrant(): boolean {
    return [...(heldTransactions.getStore() ?? [])].some((held) => held.gate === gate && held.active)
  }
  function queue<T>(work: () => Promise<T>): Promise<T> {
    if (reentrant()) return Promise.reject(new Error('Use the transaction executor inside a transaction callback'))
    if (closing) return Promise.reject(new Error('Database is closing or closed'))
    const operation = gate.tail.then(work)
    gate.tail = operation.then(() => {}, () => {})
    return operation
  }

  const database: Database = {
    dialect: 'sqlite',
    execute: (input) => {
      const query = statement(input)
      return queue(async () => result(await client.execute(query)))
    },
    transaction: (work) => queue(async () => {
      const tx = await client.transaction('write')
      const scope = { gate, active: true }
      const executor: SqlExecutor = {
        dialect: 'sqlite',
        execute: async (input) => {
          if (!scope.active) throw new Error('Transaction is closed')
          return result(await tx.execute(statement(input)))
        },
      }
      const publication = createTransactionScope(database, executor)
      try {
        const held = new Set(heldTransactions.getStore())
        held.add(scope)
        const output = await heldTransactions.run(held, () => work(publication.executor))
        await publication.complete()
        scope.active = false
        await tx.commit()
        return output
      } catch (error) {
        await publication.abort()
        scope.active = false
        try { await tx.rollback() } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'Transaction and rollback failed', { cause: error })
        }
        throw error
      } finally { tx.close() }
    }),
    close() {
      if (reentrant()) return Promise.reject(new Error('Cannot close a database inside its transaction callback'))
      closing ??= gate.tail.then(() => {
        try { client.close() } finally {
          gate.references--
          if (key && gate.references === 0) files.delete(key)
        }
      })
      return closing
    },
  }

  try {
    await database.execute(`PRAGMA busy_timeout = ${timeout}`)
    await database.execute('PRAGMA foreign_keys = ON')
    await database.execute('PRAGMA journal_mode = WAL')
    await database.execute('PRAGMA synchronous = FULL')
    return database
  } catch (error) {
    try { await database.close() } catch (closeError) {
      throw new AggregateError([error, closeError], 'Database initialization and cleanup failed', { cause: error })
    }
    throw error
  }
}
