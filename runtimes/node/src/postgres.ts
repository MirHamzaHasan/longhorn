import { AsyncLocalStorage } from 'node:async_hooks'
import { Buffer } from 'node:buffer'
import { Pool } from 'pg'
import type { CustomTypesConfig, PoolClient, QueryArrayConfig, QueryArrayResult } from 'pg'
import type { Database, QueryResult, SqlExecutor, SqlStatement, SqlValue } from '@longhorn/database'
import { createTransactionScope } from '@longhorn/database/transactions'

export type PostgresOptions = {
  readonly connectionString: string
  readonly maxConnections?: number
  /** Bounds admitted operations, and separately queued statements in each transaction. */
  readonly maxPending?: number
  readonly connectionTimeoutMs?: number
  readonly idleTimeoutMs?: number
  readonly statementTimeoutMs?: number
  readonly lockTimeoutMs?: number
  readonly idleTransactionTimeoutMs?: number
  readonly applicationName?: string
  readonly ssl?: boolean | { readonly ca?: string; readonly cert?: string; readonly key?: string; readonly servername?: string }
  /** Synchronous diagnostics only. Query errors remain on their caller's Promise. */
  readonly onConnectionError?: (error: unknown) => void
}
export interface PostgresDatabase extends Database {
  readonly dialect: 'postgres'
  stats(): { readonly total: number; readonly idle: number; readonly waiting: number; readonly active: number; readonly connectionErrors: number; readonly closing: boolean; readonly closed: boolean }
}
export class PostgresClosedError extends Error { constructor() { super('PostgreSQL database is closing or closed'); this.name = 'PostgresClosedError' } }
export class PostgresCapacityError extends Error { constructor() { super('PostgreSQL admission capacity exceeded'); this.name = 'PostgresCapacityError' } }
export class PostgresTransactionAbortedError extends Error {
  constructor(cause: unknown) { super('A transaction statement failed; the transaction was rolled back', { cause }); this.name = 'PostgresTransactionAbortedError' }
}
type NativeQuery = QueryArrayConfig<unknown[]> & { queryMode: 'extended' }
type Scope = { readonly identity: object; accepting: boolean }
const held = new AsyncLocalStorage<ReadonlySet<Scope>>()
const forbidden = new Set(['BEGIN', 'START', 'COMMIT', 'END', 'ROLLBACK', 'ABORT', 'SAVEPOINT', 'RELEASE', 'PREPARE'])
function number(value: number, name: string, minimum = 0, maximum = 2_147_483_647) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid PostgreSQL ${name}`)
  return value
}
function firstWord(sql: string): string {
  let index = 0
  while (index < sql.length) {
    if (/\s/.test(sql[index]!) || sql[index] === ';') { index++; continue }
    if (sql.startsWith('--', index)) { const end = sql.indexOf('\n', index); index = end < 0 ? sql.length : end + 1; continue }
    if (sql.startsWith('/*', index)) {
      let depth = 1; index += 2
      while (index < sql.length && depth) {
        if (sql.startsWith('/*', index)) { depth++; index += 2 }
        else if (sql.startsWith('*/', index)) { depth--; index += 2 }
        else index++
      }
      if (depth) throw new Error('Unterminated PostgreSQL SQL comment')
      continue
    }
    break
  }
  return /^[a-z]+/i.exec(sql.slice(index))?.[0]?.toUpperCase() ?? ''
}
function bind(value: SqlValue): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  throw new Error('Unsupported PostgreSQL parameter; use explicit scalar/JSON text values')
}
function statement(input: SqlStatement): NativeQuery {
  const text = typeof input === 'string' ? input : input.sql
  if (typeof text !== 'string' || !text.trim()) throw new Error('PostgreSQL SQL must be nonempty')
  if (forbidden.has(firstWord(text))) throw new Error('Use database.transaction and its executor for transaction control')
  return { text, values: typeof input === 'string' ? [] : (input.args ?? []).map(bind), rowMode: 'array', queryMode: 'extended' }
}
function scalar(value: unknown): SqlValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'bigint') return value
  if (value instanceof Uint8Array) return new Uint8Array(value)
  throw new Error('PostgreSQL returned a value outside the SQL scalar contract')
}
function result(value: QueryArrayResult<unknown[]>): QueryResult {
  return { rows: value.rows.map((row) => Object.fromEntries(value.fields.map((field, index) => [field.name, scalar(row[index])]))),
    rowsAffected: value.rowCount ?? 0, lastInsertId: undefined }
}
// Per-pool text parsers: never change pg's process-global parser registry.
const parsers: CustomTypesConfig = { getTypeParser: ((oid: number, format?: string) => {
  if (format === 'binary') throw new Error('Binary PostgreSQL result format is unsupported')
  if (oid === 16) return (value: string) => value === 't'
  if ([21, 23, 26, 700, 701].includes(oid)) return (value: string) => Number(value)
  if (oid === 20) return (value: string) => BigInt(value)
  if (oid === 17) return (value: string) => {
    if (!/^\\x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error('Expected PostgreSQL hex bytea output')
    return Buffer.from(value.slice(2), 'hex')
  }
  return (value: string) => value // exact numeric, JSON, timestamps, arrays, UUIDs and unknown types
}) as CustomTypesConfig['getTypeParser'] }

/** Direct TCP PostgreSQL. Owns one bounded pg pool; native $n SQL is never rewritten. */
export async function openPostgres(options: PostgresOptions): Promise<PostgresDatabase> {
  let url: URL
  try { url = new URL(options.connectionString) } catch { throw new Error('Invalid PostgreSQL connection URL') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2 || url.search || url.hash) throw new Error('Invalid PostgreSQL TCP URL: specify user/database without query/hash options')
  let user: string, password: string, databaseName: string
  try { user = decodeURIComponent(url.username); password = decodeURIComponent(url.password); databaseName = decodeURIComponent(url.pathname.slice(1)) } catch { throw new Error('Invalid PostgreSQL URL encoding') }
  const max = number(options.maxConnections ?? 10, 'maxConnections', 1, 100)
  const maxPending = number(options.maxPending ?? 256, 'maxPending', 1, 100_000)
  const connectionTimeoutMillis = number(options.connectionTimeoutMs ?? 5000, 'connectionTimeoutMs', 1)
  const idleTimeoutMillis = number(options.idleTimeoutMs ?? 10_000, 'idleTimeoutMs')
  const statementTimeout = number(options.statementTimeoutMs ?? 30_000, 'statementTimeoutMs')
  const lockTimeout = number(options.lockTimeoutMs ?? 5000, 'lockTimeoutMs')
  const idleTransactionTimeout = number(options.idleTransactionTimeoutMs ?? 30_000, 'idleTransactionTimeoutMs')
  const applicationName = options.applicationName ?? 'longhorn'
  if (typeof applicationName !== 'string' || !applicationName || applicationName.length > 64 || /[\x00-\x1f\x7f]/.test(applicationName)) throw new Error('Invalid PostgreSQL applicationName')
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  const ssl = options.ssl === false || (options.ssl === undefined && local) ? false
    : { ...(typeof options.ssl === 'object' ? options.ssl : {}), rejectUnauthorized: true }
  // Pass every connection component explicitly; pg environment/pgpass defaults cannot select credentials or a database.
  const pool = new Pool({ host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port ? Number(url.port) : 5432,
    user, password: async () => password, database: databaseName, max, connectionTimeoutMillis, idleTimeoutMillis,
    statement_timeout: statementTimeout, lock_timeout: lockTimeout, idle_in_transaction_session_timeout: idleTransactionTimeout,
    application_name: applicationName, ssl, types: parsers, keepAlive: true })
  const identity = {}, active = new Set<Promise<void>>()
  let closing: Promise<void> | undefined, closed = false, connectionErrors = 0
  const report = (error: unknown) => { connectionErrors++; try { options.onConnectionError?.(error) } catch { /* Diagnostics cannot crash the pool. */ } }
  pool.on('error', report)
  const reentrant = () => [...(held.getStore() ?? [])].some((scope) => scope.identity === identity && scope.accepting)
  function accept<T>(work: () => Promise<T>): Promise<T> {
    if (reentrant()) return Promise.reject(new Error('Use the transaction executor inside its callback'))
    if (closing) return Promise.reject(new PostgresClosedError())
    if (active.size >= maxPending) return Promise.reject(new PostgresCapacityError())
    const operation = Promise.resolve().then(work).finally(() => { active.delete(settled) })
    const settled = operation.then(() => {}, () => {})
    active.add(settled); return operation
  }
  async function lease<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    let broken: { error: unknown } | undefined, failure: { error: unknown } | undefined, output!: T
    const onError = (error: unknown) => { broken ??= { error }; report(error) }
    client.on('error', onError)
    try {
      // Restored on each lease, including after DISCARD reset. No untrusted search_path.
      await client.query({ text: `SELECT pg_catalog.set_config('statement_timeout',$1,false),
        pg_catalog.set_config('lock_timeout',$2,false), pg_catalog.set_config('idle_in_transaction_session_timeout',$3,false),
        pg_catalog.set_config('search_path','pg_catalog',false), pg_catalog.set_config('TimeZone','UTC',false),
        pg_catalog.set_config('DateStyle','ISO, YMD',false), pg_catalog.set_config('bytea_output','hex',false),
        pg_catalog.set_config('application_name',$4,false)`, values: [String(statementTimeout), String(lockTimeout), String(idleTransactionTimeout), applicationName] })
      output = await work(client)
      if (broken) throw broken.error
    } catch (error) { failure = { error } }
    if (!broken) {
      try { await client.query('DISCARD ALL') } catch (error) {
        broken = { error }
        failure = { error: failure ? new AggregateError([failure.error, error], 'PostgreSQL operation and session cleanup failed', { cause: failure.error }) : error }
      }
    }
    client.removeListener('error', onError)
    client.release(broken ? true : undefined)
    if (failure) throw failure.error
    return output
  }
  const database: PostgresDatabase = {
    dialect: 'postgres',
    stats: () => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, active: active.size,
      connectionErrors, closing: closing !== undefined, closed }),
    execute(input) {
      let query: NativeQuery
      try { query = statement(input) } catch (error) { return Promise.reject(error) }
      return accept(() => lease(async (client) => result(await client.query<unknown[]>(query))))
    },
    transaction: (work) => accept(() => lease(async (client) => {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      const scope: Scope = { identity, accepting: true }
      let tail: Promise<void> = Promise.resolve(), pending = 0, statementFailure: { error: unknown } | undefined
      const executor: SqlExecutor = { dialect: 'postgres', execute(input) {
        if (!scope.accepting) return Promise.reject(new Error('Transaction is closed'))
        if (pending >= maxPending) return Promise.reject(new PostgresCapacityError())
        let query: NativeQuery
        try { query = statement(input) } catch (error) { return Promise.reject(error) }
        pending++
        const operation = tail.then(async () => result(await client.query<unknown[]>(query)))
        tail = operation.then(() => { pending-- }, (error) => { pending--; statementFailure ??= { error } })
        return operation
      } }
      const publication = createTransactionScope(database, executor)
      try {
        const scopes = new Set(held.getStore()); scopes.add(scope)
        const output = await held.run(scopes, () => work(publication.executor))
        await publication.complete()
        scope.accepting = false; await tail
        if (statementFailure) throw new PostgresTransactionAbortedError(statementFailure.error)
        const committed = await client.query('COMMIT')
        if (committed.command !== 'COMMIT') throw new PostgresTransactionAbortedError(new Error('Server did not commit the transaction'))
        return output
      } catch (error) {
        await publication.abort()
        scope.accepting = false; await tail
        try { await client.query('ROLLBACK') } catch (rollbackError) { throw new AggregateError([error, rollbackError], 'PostgreSQL transaction and rollback failed', { cause: error }) }
        throw error
      } finally { scope.accepting = false }
    })),
    close() {
      if (reentrant()) return Promise.reject(new Error('Cannot close a database inside its transaction callback'))
      closing ??= (async () => { await Promise.all([...active]); try { await pool.end() } finally { closed = true } })()
      return closing
    },
  }
  try { await database.execute('SELECT 1'); return database }
  catch (error) { try { await database.close() } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'PostgreSQL startup and cleanup failed', { cause: error }) }; throw error }
}
