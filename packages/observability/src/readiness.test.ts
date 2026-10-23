import { expect, it, vi } from 'vitest'
import { Readiness } from './readiness.js'
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done }); return { promise, resolve } }
it('requires startup, reports explicit checks and fails closed without exposing error text', async () => {
  const readiness = new Readiness()
  readiness.add('database', () => true).add('worker', () => false).add('provider', () => { throw new Error('private-token-value') })
  expect(await readiness.check()).toEqual({ status: 'not-ready', phase: 'starting', checks: [] })
  readiness.start()
  const report = await readiness.check()
  expect(report.status).toBe('not-ready')
  expect(report.checks.map((check) => check.status)).toEqual(['pass', 'fail', 'fail'])
  expect(JSON.stringify(report)).not.toContain('private-token-value')
  expect(() => readiness.add('late', () => true)).toThrow('before start')
  await readiness.close(); expect((await readiness.check()).phase).toBe('closed')
})
it('coalesces concurrent probes without warming a stale health cache', async () => {
  const release = deferred(), started = deferred(), readiness = new Readiness()
  let calls = 0, healthy = true
  readiness.add('shared', async () => { calls++; started.resolve(); await release.promise; return healthy })
  readiness.start()
  const reports = Array.from({ length: 20 }, () => readiness.check())
  await started.promise; expect(calls).toBe(1)
  release.resolve(); expect((await Promise.all(reports)).every((report) => report.status === 'ready')).toBe(true)
  healthy = false; expect((await readiness.check()).status).toBe('not-ready'); expect(calls).toBe(2)
  await readiness.close()
})
it('times out responses and signals cancellation without spawning another stuck operation', async () => {
  vi.useFakeTimers()
  try {
    const release = deferred(), started = deferred(), readiness = new Readiness({ timeoutMs: 10 })
    let calls = 0, signal!: AbortSignal
    readiness.add('slow', async (context) => { calls++; signal = context.signal; started.resolve(); await release.promise; return true })
    readiness.start(); const pending = readiness.check(); await started.promise
    await vi.advanceTimersByTimeAsync(10)
    expect((await pending).checks[0]?.status).toBe('timeout'); expect(signal.aborted).toBe(true)
    expect((await readiness.check()).checks[0]?.status).toBe('busy'); expect(calls).toBe(1)
    let closed = false; const closing = readiness.close().then(() => { closed = true })
    await Promise.resolve(); expect(closed).toBe(false)
    release.resolve(); await closing; expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})
it('draining cancels pending probe responses and waits for the underlying dependency operation', async () => {
  const release = deferred(), started = deferred(), readiness = new Readiness()
  readiness.add('dependency', async ({ signal }) => { started.resolve(); await release.promise; expect(signal.aborted).toBe(true); return true })
  readiness.start(); const probe = readiness.check(); await started.promise
  readiness.beginDrain()
  expect((await probe).checks[0]?.status).toBe('cancelled')
  expect(await readiness.check()).toEqual({ status: 'not-ready', phase: 'draining', checks: [] })
  const closing = readiness.close(); expect(readiness.close()).toBe(closing)
  release.resolve(); await closing
  expect(() => readiness.start()).toThrow('once')
})
it('validates check identities, deadlines and bounds before starting work', async () => {
  const readiness = new Readiness({ maxChecks: 1 })
  expect(() => readiness.add('bad name', () => true)).toThrow('name')
  expect(() => readiness.add(1 as never, () => true)).toThrow('name')
  expect(() => readiness.add('invalid', false as never)).toThrow('function')
  readiness.add('one', () => true)
  expect(() => readiness.add('one', () => true)).toThrow('duplicate')
  expect(() => readiness.add('two', () => true)).toThrow('capacity')
  expect(() => new Readiness({ timeoutMs: 0 })).toThrow('timeout')
  await readiness.close()
})
