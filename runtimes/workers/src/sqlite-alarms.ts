import type { DurableObjectStorage } from '@cloudflare/workers-types'
import type { Database, Migration, SqlExecutor } from '@longhorn/database'
import type { TaskApplication } from '@longhorn/runtime'
import type { DurableSqliteState } from './durable-sqlite.js'
import { assertOwner, installCommitHook } from './durable-commit.js'

export type DurableAlarmState = DurableSqliteState & {
  readonly storage: Pick<DurableObjectStorage, 'sql' | 'transaction' | 'sync' | 'getAlarm' | 'setAlarm' | 'deleteAlarm'>
}
export type WorkerAlarmInfo = { readonly retryCount: number; readonly isRetry: boolean }
export type SqliteAlarmOptions = {
  readonly database: Database
  readonly application: TaskApplication
  readonly queues: readonly string[]
  readonly handle: (invocation: { readonly signal: AbortSignal; readonly limit: number; readonly info: WorkerAlarmInfo }) => void | Promise<void>
  readonly batchSize?: number
  readonly minDelayMs?: number
  readonly failureDelayMs?: number
  readonly timeoutMs?: number
  readonly now?: () => number
}
/** Append after the application's deployed queue/scheduler/result migration prefix. */
export const alarmClockMigrations: readonly Migration[] = [{ id: 'longhorn_worker_alarm/001_clock', statements: [
  'CREATE TABLE longhorn_alarm_clock (id INTEGER PRIMARY KEY CHECK(id = 1), retry_after INTEGER NOT NULL CHECK(retry_after >= 0)) STRICT',
  'INSERT INTO longhorn_alarm_clock(id,retry_after) VALUES(1,0)',
] }]
export class AlarmClosedError extends Error { constructor() { super('Alarm clock is closing or closed'); this.name = 'AlarmClosedError' } }
export class AlarmTimeoutError extends Error { constructor() { super('Alarm invocation budget exceeded'); this.name = 'AlarmTimeoutError' } }
const MAX_TIME = 8_640_000_000_000_000
const integer = (value: number, maximum: number) => Number.isSafeInteger(value) && value >= 1 && value <= maximum
function timestamp(value: unknown): number {
  const result = typeof value === 'bigint' ? Number(value) : value
  if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < 0 || result > MAX_TIME) throw new Error('Invalid alarm timestamp')
  return result
}

export type SqliteAlarmClock = {
  start(): Promise<void>
  reconcile(): Promise<void>
  alarm(info?: WorkerAlarmInfo): Promise<void>
  /** Keeps persisted wakeups; stop dependent writers before releasing this clock. */
  close(): Promise<void>
  getAlarm(): Promise<number | null>
  stats(): { started: boolean; active: number; pending: boolean; runs: number; failed: number; timedOut: number; coalesced: number; closing: boolean; closed: boolean }
}

/** One exclusive alarm owner for SQLite queue/scheduler tables in one Durable Object. */
export function createSqliteAlarmClock(state: DurableAlarmState, options: SqliteAlarmOptions): SqliteAlarmClock {
  const database = options.database, application = options.application, queues = [...options.queues], handle = options.handle,
    batchSize = options.batchSize ?? 10, minimum = options.minDelayMs ?? 100, failureDelay = options.failureDelayMs ?? 1000,
    timeout = options.timeoutMs ?? 30000, now = options.now ?? Date.now
  assertOwner(database, state.storage)
  if (!queues.length || queues.length > 64 || new Set(queues).size !== queues.length || queues.some(name => !/^[A-Za-z0-9._-]{1,100}$/.test(name))) throw new Error('Invalid alarm queue names')
  if (!integer(batchSize, 1000) || !integer(minimum, 60000) || !integer(failureDelay, 3600000) || !integer(timeout, 900000)) throw new Error('Invalid alarm clock bounds')
  if (typeof handle !== 'function' || typeof now !== 'function' || typeof state.storage.getAlarm !== 'function' || typeof state.storage.setAlarm !== 'function' || typeof state.storage.deleteAlarm !== 'function') throw new Error('Invalid alarm clock capabilities')
  const names = queues.map(() => '(?)').join(','), entered = new Set<Promise<void>>()
  let initialization: Promise<void> | undefined, inFlight: Promise<void> | undefined, closing: Promise<void> | undefined,
    uninstall: (() => void) | undefined, started = false, closed = false, refresh = true, runs = 0, failed = 0, timedOut = 0, coalesced = 0
  const clockNow = () => timestamp(now())
  const later = (delay: number) => Math.min(MAX_TIME, clockNow() + delay)

  async function rearm(executor: SqlExecutor): Promise<void> {
    const row = (await executor.execute({ sql: `WITH managed(queue) AS (VALUES ${names}) SELECT MIN(at) AS at FROM (
      SELECT MIN(next_at) AS at FROM longhorn_schedules WHERE state = 'active' AND queue IN (SELECT queue FROM managed)
      UNION ALL SELECT MIN(available_at) FROM longhorn_queue_jobs WHERE state = 'pending' AND queue IN (SELECT queue FROM managed)
      UNION ALL SELECT MIN(lease_until) FROM longhorn_queue_jobs WHERE state = 'running' AND queue IN (SELECT queue FROM managed)
    )`, args: queues })).rows[0]!
    const floor = (await executor.execute('SELECT retry_after FROM longhorn_alarm_clock WHERE id = 1')).rows[0]
    if (!floor) throw new Error('Alarm clock migration is required')
    const existing = await state.storage.getAlarm()
    if (row.at === null) { if (existing !== null) await state.storage.deleteAlarm(); return }
    const due = Math.max(timestamp(row.at), timestamp(floor.retry_after))
    let target = Math.max(due, later(minimum))
    // Do not slide an already adequate near/due wakeup forward on every SQL read.
    if (existing !== null && existing >= due && existing <= Math.min(MAX_TIME, target + 1)) {
      // A same-timestamp write can be coalesced without restoring a cold local runtime's timer index.
      // Change the persisted value on activation; retain this 1ms tolerance on subsequent reads.
      if (refresh) {
        if (existing === target) target = target < MAX_TIME ? target + 1 : target - 1
        await state.storage.setAlarm(target)
      }
      refresh = false
      return
    }
    await state.storage.setAlarm(target)
    refresh = false
  }
  const barrier = () => database.transaction(async () => {})
  return {
    start() {
      if (closing) return Promise.reject(new AlarmClosedError())
      initialization ??= Promise.resolve().then(async () => {
        uninstall = installCommitHook(database, state.storage, rearm)
        try { await barrier(); started = true }
        catch (error) { uninstall(); uninstall = undefined; throw error }
      })
      return initialization
    },
    async reconcile() {
      if (closing) throw new AlarmClosedError()
      if (!started) throw new Error('Alarm clock must be started after migrations')
      const work = barrier(), settled = work.then(() => {}, () => {})
      entered.add(settled)
      try { await work } finally { entered.delete(settled) }
    },
    alarm(info = { retryCount: 0, isRetry: false }) {
      if (closing) return Promise.reject(new AlarmClosedError())
      if (!info || typeof info !== 'object' || !Number.isSafeInteger(info.retryCount) || info.retryCount < 0 || typeof info.isRetry !== 'boolean') return Promise.reject(new Error('Invalid alarm invocation metadata'))
      if (inFlight) { coalesced++; return inFlight }
      const cancellation = new AbortController(), timer = setTimeout(() => { timedOut++; cancellation.abort(new AlarmTimeoutError()) }, timeout)
      runs++
      const operation = Promise.resolve().then(() => application.run(async () => {
        if (closing) throw new AlarmClosedError()
        if (!initialization) throw new Error('Alarm clock must be started after migrations')
        await initialization
        if (closing) throw new AlarmClosedError()
        const work = Promise.resolve().then(async () => {
          try {
            cancellation.signal.throwIfAborted()
            await database.execute('UPDATE longhorn_alarm_clock SET retry_after = 0 WHERE id = 1')
            await handle({ signal: cancellation.signal, limit: batchSize, info })
            cancellation.signal.throwIfAborted()
            await barrier()
            cancellation.signal.throwIfAborted()
          } catch (error) {
            try { await database.execute({ sql: 'UPDATE longhorn_alarm_clock SET retry_after = ? WHERE id = 1', args: [later(failureDelay)] }) }
            catch (rearmError) { throw new AggregateError([error, rearmError], 'Alarm work and recovery rearm failed', { cause: error }) }
            throw error
          }
        })
        const settled = work.then(() => {}, () => {})
        entered.add(settled)
        try { await work } finally { entered.delete(settled) }
      })).catch(error => { failed++; throw error }).finally(() => { clearTimeout(timer); inFlight = undefined })
      inFlight = operation
      return operation
    },
    close() {
      closing ??= (async () => {
        // Waiting for an invocation still awaiting app.start here would deadlock startup rollback.
        await Promise.all([...entered])
        try { if (initialization) { await initialization; await barrier() } }
        finally { uninstall?.(); uninstall = undefined; closed = true }
      })()
      return closing
    },
    getAlarm: () => state.storage.getAlarm(),
    stats: () => ({ started, active: entered.size, pending: inFlight !== undefined, runs, failed, timedOut, coalesced, closing: closing !== undefined, closed }),
  }
}
