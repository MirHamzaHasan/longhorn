import { expect, it, vi } from 'vitest'
import type { Database, SqlExecutor } from './index.js'
import { assertTransactionExecutor, createTransactionScope, isTransactionExecutor, participateInTransaction } from './transactions.js'
const empty = { rows: [], rowsAffected: 0, lastInsertId: undefined }
const owner = (): Database => ({ execute: async () => empty, transaction: async () => { throw new Error('unused') }, close: async () => {} })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { resolve, promise } }

it('recognizes only original active transaction executors for the exact database and preserves method ownership', async () => {
  const database = owner(), delegate: SqlExecutor = { dialect: 'sqlite', async execute() { expect(this).toBe(delegate); return empty } }
  const scope = createTransactionScope(database, delegate)
  expect(isTransactionExecutor(database)).toBe(false); expect(isTransactionExecutor({ ...scope.executor })).toBe(false)
  expect(Object.isFrozen(scope.executor)).toBe(true); expect(scope.executor.dialect).toBe('sqlite')
  expect(() => assertTransactionExecutor(scope.executor, owner())).toThrow('different database')
  expect(() => assertTransactionExecutor(scope.executor, database)).not.toThrow(); await scope.executor.execute('SELECT 1')
  await scope.complete(); expect(isTransactionExecutor(scope.executor)).toBe(false)
  await expect(scope.executor.execute('SELECT 1')).rejects.toThrow('closed')
})
it('joins accepted participants while expiring the public executor at callback completion', async () => {
  const scope = createTransactionScope(owner(), { execute: async () => empty }), release = deferred()
  const pending = participateInTransaction(scope.executor, async executor => { await release.promise; return executor.execute('INSERT') })
  const completing = scope.complete(); expect(scope.complete()).toBe(completing)
  await expect(scope.executor.execute('SELECT')).rejects.toThrow('closed')
  let finished = false; completing.then(() => { finished = true }); await Promise.resolve(); expect(finished).toBe(false)
  release.resolve(); expect(await pending).toBe(empty); await completing
})
it('poisons completion for an accepted failure even if the caller catches it', async () => {
  const scope = createTransactionScope(owner(), { execute: async () => empty }), original = { reason: 'validation' }
  await participateInTransaction(scope.executor, () => { throw original }).catch(() => {})
  await expect(scope.complete()).rejects.toBe(original); await scope.abort()
})
it('retains the first failure in registration order without losing undefined rejections', async () => {
  const scope = createTransactionScope(owner(), { execute: async () => empty }), gate = deferred()
  const first = participateInTransaction(scope.executor, async () => { await gate.promise; throw undefined })
  const second = participateInTransaction(scope.executor, () => { throw new Error('later registered') })
  const observed = Promise.allSettled([first, second]), completing = expect(scope.complete()).rejects.toBeUndefined()
  gate.resolve(); await observed; await completing
})
it('drains aborting participants but prevents their later writes and expires retained descendants', async () => {
  const write = vi.fn(async () => empty), scope = createTransactionScope(owner(), { execute: write }), release = deferred()
  let retained!: SqlExecutor
  const pending = participateInTransaction(scope.executor, async executor => { retained = executor; await release.promise; return executor.execute('INSERT') })
  const observed = expect(pending).rejects.toThrow('closed'), aborting = scope.abort()
  release.resolve(); await observed; await aborting; expect(write).not.toHaveBeenCalled()
  expect(isTransactionExecutor(retained)).toBe(false); await expect(retained.execute('SELECT')).rejects.toThrow('closed')
})
it('registers work synchronously and rejects registration after sealing', async () => {
  const scope = createTransactionScope(owner(), { execute: async () => empty }), admitted = vi.fn()
  const pending = participateInTransaction(scope.executor, admitted); expect(admitted).toHaveBeenCalledTimes(1)
  const completed = scope.complete(); await expect(participateInTransaction(scope.executor, admitted)).rejects.toThrow('active managed')
  await pending; await completed
  const database = owner(); expect(() => createTransactionScope(database, database)).toThrow('transaction-specific')
})
