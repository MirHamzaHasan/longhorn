import type { Database, SqlExecutor } from './index.js'

declare const transactionExecutor: unique symbol
export type TransactionExecutor = SqlExecutor & { readonly [transactionExecutor]: true }
type Registration = {
  readonly database: Database
  readonly active: () => boolean
  readonly participate: <T>(work: (executor: TransactionExecutor) => T | Promise<T>) => Promise<T>
}
const scopes = new WeakMap<SqlExecutor, Registration>()
const expired = () => new Error('Transaction is closed')

export function isTransactionExecutor(executor: SqlExecutor): executor is TransactionExecutor {
  return scopes.get(executor)?.active() === true
}
/** Verify an original active scope, optionally belonging to this exact database handle. */
export function assertTransactionExecutor(executor: SqlExecutor, database?: Database): asserts executor is TransactionExecutor {
  const registration = scopes.get(executor)
  if (!registration?.active()) throw new Error('An active managed transaction executor is required')
  if (database !== undefined && registration.database !== database) throw new Error('Transaction belongs to a different database')
}
/** Register resource-using descendant work before the callback returns; the provider joins it before commit. */
export function participateInTransaction<T>(executor: SqlExecutor, work: (executor: TransactionExecutor) => T | Promise<T>): Promise<T> {
  try { assertTransactionExecutor(executor); return scopes.get(executor)!.participate(work) }
  catch (error) { return Promise.reject(error) }
}

/** Provider API: call complete before COMMIT, or abort before ROLLBACK. Neither method controls native SQL. */
export function createTransactionScope(database: Database, delegate: SqlExecutor): {
  readonly executor: TransactionExecutor
  complete(): Promise<void>
  abort(): Promise<void>
} {
  if (delegate === database) throw new Error('Transaction scope requires a transaction-specific executor')
  let phase: 'open' | 'draining' | 'aborting' | 'closed' = 'open', sequence = 0
  let failure: { index: number; error: unknown } | undefined, completion: Promise<void> | undefined, abortion: Promise<void> | undefined
  const pending = new Set<Promise<void>>()
  function scoped(active: () => boolean): TransactionExecutor {
    const value = Object.freeze({ ...(delegate.dialect === undefined ? {} : { dialect: delegate.dialect }), execute(input: Parameters<SqlExecutor['execute']>[0]) {
      if (!active()) return Promise.reject(expired())
      try { return Promise.resolve(delegate.execute(input)) } catch (error) { return Promise.reject(error) }
    } }) as TransactionExecutor
    scopes.set(value, { database, active, participate })
    return value
  }
  function participate<T>(work: (executor: TransactionExecutor) => T | Promise<T>): Promise<T> {
    if (phase !== 'open') return Promise.reject(expired())
    const index = sequence++
    let active = true
    const executor = scoped(() => active && (phase === 'open' || phase === 'draining'))
    let result: T | Promise<T>
    try { result = work(executor) } catch (error) { result = Promise.reject(error) }
    const operation = Promise.resolve(result).catch(error => {
      if (!failure || index < failure.index) failure = { index, error }
      throw error
    }).finally(() => { active = false; scopes.delete(executor); pending.delete(settled) })
    const settled = operation.then(() => {}, () => {})
    pending.add(settled)
    return operation
  }
  const executor = scoped(() => phase === 'open')
  async function drain(): Promise<void> { while (pending.size) await Promise.all([...pending]) }
  const release = () => { phase = 'closed'; scopes.delete(executor); failure = undefined }
  return {
    executor,
    complete() {
      if (phase === 'aborting' || (phase === 'closed' && !completion)) return Promise.reject(expired())
      completion ??= (async () => {
        phase = 'draining'
        try { await drain(); if (failure) throw failure.error } finally { release() }
      })()
      return completion
    },
    abort() {
      if (phase === 'closed') return Promise.resolve()
      phase = 'aborting'
      abortion ??= drain().finally(release)
      return abortion
    },
  }
}
