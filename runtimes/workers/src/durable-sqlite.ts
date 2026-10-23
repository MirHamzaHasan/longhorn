import type { DurableObjectState, DurableObjectStorage, SqlStorageValue } from '@cloudflare/workers-types'
import type { Database, QueryResult, SqlExecutor, SqlStatement, SqlValue } from '@longhorn/database'
import { createTransactionScope } from '@longhorn/database/transactions'
import { beforeCommit, rememberOwner } from './durable-commit.js'

export type DurableSqliteState = Pick<DurableObjectState, 'blockConcurrencyWhile'> & {
  readonly storage: Pick<DurableObjectStorage, 'sql' | 'transaction' | 'sync'>
}
export type DurableSqliteOptions = { readonly maxPending?: number }
type Gate = { tail: Promise<void>; pending: number; active: boolean }
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown }
const gates = new WeakMap<object, Gate>()

function numeric(value: number): number {
  if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
    throw new Error('Durable SQLite cannot represent this SQL number exactly')
  }
  return value
}
function bind(value: SqlValue): SqlStorageValue {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error('Durable SQLite bigint is outside the safe integer range')
    }
    return Number(value)
  }
  if (typeof value === 'number') return numeric(value)
  if (value instanceof Uint8Array) return new Uint8Array(value).buffer
  if (value === null || typeof value === 'string') return value
  throw new Error('Unsupported Durable SQLite bind value')
}
function query(input: SqlStatement): { sql: string; args: SqlStorageValue[] } {
  const sql = typeof input === 'string' ? input : input.sql
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('SQL statement must not be empty')
  return { sql, args: (typeof input === 'string' ? [] : input.args ?? []).map(bind) }
}
function value(input: unknown): SqlValue {
  if (typeof input === 'number') return numeric(input)
  if (input === null || typeof input === 'string') return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0))
  throw new Error('Unsupported Durable SQLite result value')
}

/** Borrow a SQLite-backed Durable Object's storage. Never opens/deletes a platform database. */
export function createDurableSqlite(state: DurableSqliteState, options: DurableSqliteOptions = {}): Database {
  const maximum = options.maxPending ?? 64
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1024) throw new Error('Invalid Durable SQLite maxPending')
  const storage = state.storage
  if (!storage.sql || typeof storage.sql.exec !== 'function') throw new Error('SQLite-backed Durable Object storage is required')
  const gate = gates.get(storage) ?? { tail: Promise.resolve(), pending: 0, active: false }
  gates.set(storage, gate)
  let closing: Promise<void> | undefined

  function execute(statement: ReturnType<typeof query>): QueryResult {
    const before = storage.sql.exec('SELECT CAST(total_changes() AS TEXT) AS total').toArray()[0]!.total
    // Fully materialize before yielding: a platform cursor must never escape its transaction.
    const rows = storage.sql.exec(statement.sql, ...statement.args).toArray()
      .map(row => Object.fromEntries(Object.entries(row).map(([key, item]) => [key, value(item)])))
    // Read row IDs as text before converting to bigint; the native numeric cursor can lose int64 precision.
    const meta = storage.sql.exec('SELECT CAST(total_changes() AS TEXT) AS total, changes() AS changed, CAST(last_insert_rowid() AS TEXT) AS id').toArray()[0]!
    const changed = meta.total === before ? 0 : numeric(meta.changed as number)
    return { rows, rowsAffected: changed, lastInsertId: BigInt(meta.id as string) }
  }
  function admit<T>(work: () => Promise<T>): Promise<T> {
    if (gate.active) return Promise.reject(new Error('Use the transaction executor; root work is blocked during a Durable SQLite operation'))
    if (closing) return Promise.reject(new Error('Database is closing or closed'))
    if (gate.pending >= maximum) return Promise.reject(new Error('Durable SQLite capacity exceeded'))
    gate.pending++
    const operation = gate.tail.then(async () => {
      // Catch inside the input gate: an ordinary SQL/domain failure must not reset the Object.
      const outcome = await state.blockConcurrencyWhile<Outcome<T>>(async () => {
        gate.active = true
        try { return { ok: true, value: await storage.transaction(async () => {
          const result = await work()
          let active = true
          try {
            await beforeCommit(storage, { dialect: 'sqlite', async execute(input) {
              if (!active) throw new Error('Transaction is closed')
              return execute(query(input))
            } })
          } finally { active = false }
          return result
        }) } }
        catch (error) { return { ok: false, error } }
        finally { gate.active = false }
      })
      if (!outcome.ok) throw outcome.error
      return outcome.value
    }).finally(() => { gate.pending-- })
    gate.tail = operation.then(() => {}, () => {})
    return operation
  }
  const database: Database = {
    dialect: 'sqlite',
    execute(input) {
      try { const statement = query(input); return admit(async () => execute(statement)) }
      catch (error) { return Promise.reject(error) }
    },
    transaction(work) {
      return admit(async () => {
        let active = true
        const executor: SqlExecutor = {
          dialect: 'sqlite',
          async execute(input) {
            if (!active) throw new Error('Transaction is closed')
            return execute(query(input))
          },
        }
        const publication = createTransactionScope(database, executor)
        try {
          const result = await work(publication.executor)
          await publication.complete()
          return result
        } catch (error) { await publication.abort(); throw error }
        finally { active = false }
      })
    },
    close() {
      closing ??= gate.tail.then(() => storage.sync())
      return closing
    },
  }
  rememberOwner(database, storage)
  return database
}
