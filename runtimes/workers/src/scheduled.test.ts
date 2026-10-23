import { expect,it,vi } from 'vitest'
import { Longhorn } from '@longhorn/core'
import { createScheduledWorker } from './scheduled.js'
import type { WorkerScheduledController } from './scheduled.js'
import type { WorkerExecutionContext } from './index.js'
const context=(): WorkerExecutionContext => ({ waitUntil: vi.fn(),passThroughOnException: vi.fn(),props: {} })
const controller=(time=1000): WorkerScheduledController => ({ scheduledTime: time,cron: '* * * * *',noRetry: vi.fn() })
function deferred<T=void>() { let resolve!: (value: T) => void;const promise=new Promise<T>(done => { resolve=done });return { resolve,promise } }

it('forwards original controller/bindings/context, preserves method ownership, and registers the exact completion',async () => {
  const app=new Longhorn<{ name: string }>(),event=controller(),env={ name: 'one' },ctx=context()
  event.noRetry=function() { expect(this).toBe(event) }
  app.http.get('/',c => c.text(c.env.name))
  const worker=createScheduledWorker(app,{ handle: async invocation => {
    expect(invocation.controller).toBe(event);expect(invocation.bindings).toBe(env);expect(invocation.context).toBe(ctx)
    invocation.controller.noRetry();expect(invocation.signal.aborted).toBe(false)
  } })
  const pending=worker.scheduled(event,env,ctx);expect(ctx.waitUntil).toHaveBeenCalledWith(pending)
  await pending;expect(worker.stats()).toMatchObject({ active: 0,succeeded: 1,failed: 0 })
  expect(await(await worker.fetch(new Request('http://localhost/'),env,context())).text()).toBe('one')
  await worker.close();expect(app.state).toBe('running');await app.close()
})
it('shares one startup with Fetch while keeping concurrent bindings separate and rejecting overflow',async () => {
  const started=vi.fn(),app=new Longhorn<{ name: string }>().onStart(started),entered=deferred(),release=deferred(),names: string[]=[]
  const worker=createScheduledWorker(app,{ maxConcurrent: 2,handle: async ({ bindings }) => { names.push(bindings.name);if (names.length===2) entered.resolve();await release.promise;names.push(bindings.name) } })
  const one=worker.scheduled(controller(),{ name: 'one' },context()),two=worker.scheduled(controller(2000),{ name: 'two' },context())
  await entered.promise
  await expect(worker.scheduled(controller(),{ name: 'overflow' },context())).rejects.toMatchObject({ name: 'ScheduledCapacityError' })
  release.resolve();await Promise.all([one,two]);expect(names).toEqual(['one','two','one','two']);expect(started).toHaveBeenCalledTimes(1)
  await worker.close();await app.close()
})
it('preserves a handler rejection without retrying or automatically suppressing platform retries',async () => {
  const app=new Longhorn(),event=controller(),original={ reason: 'domain failure' },handle=vi.fn(() => { throw original })
  const worker=createScheduledWorker(app,{ handle })
  await expect(worker.scheduled(event,{},context())).rejects.toBe(original)
  expect(event.noRetry).not.toHaveBeenCalled();expect(handle).toHaveBeenCalledTimes(1)
  expect(worker.stats()).toMatchObject({ failed: 1,active: 0 });await worker.close();await app.close()
})
it('signals cooperative budget expiration and reports success-after-expiry as a failed invocation',async () => {
  const app=new Longhorn(),worker=createScheduledWorker(app,{ timeoutMs: 10,handle: async ({ signal }) => {
    await new Promise(resolve => signal.addEventListener('abort',resolve,{ once: true }))
  } })
  await expect(worker.scheduled(controller(),{},context())).rejects.toMatchObject({ name: 'ScheduledTimeoutError' })
  expect(worker.stats()).toMatchObject({ timedOut: 1,failed: 1,succeeded: 0,active: 0 });await worker.close();await app.close()
})
it('keeps ignored cancellation work/resource ownership until actual settlement and drains both close methods',async () => {
  const released=vi.fn(),entered=deferred(),release=deferred(),app=new Longhorn().onStart(() => released)
  const worker=createScheduledWorker(app,{ timeoutMs: 10,handle: async () => { entered.resolve();await release.promise } })
  const pending=worker.scheduled(controller(),{},context()),observed=expect(pending).rejects.toMatchObject({ name: 'ScheduledTimeoutError' })
  await entered.promise;await vi.waitFor(() => expect(worker.stats().timedOut).toBe(1))
  expect(worker.stats().active).toBe(1);await expect(worker.scheduled(controller(),{},context())).rejects.toMatchObject({ name: 'ScheduledCapacityError' })
  const closing=worker.close(),appClosing=app.close();expect(worker.close()).toBe(closing);expect(released).not.toHaveBeenCalled()
  await expect(worker.scheduled(controller(),{},context())).rejects.toMatchObject({ name: 'ScheduledClosedError' })
  release.resolve();await observed;await closing;await appClosing
  expect(released).toHaveBeenCalledTimes(1);expect(worker.stats()).toMatchObject({ closed: true,active: 0 })
})
it('does not start the application when platform lifetime registration rejects',async () => {
  const start=vi.fn(),handle=vi.fn(),app=new Longhorn().onStart(start),ctx=context(),failure=new Error('context registration failed')
  ctx.waitUntil=() => { throw failure }
  const worker=createScheduledWorker(app,{ handle })
  await expect(worker.scheduled(controller(),{},ctx)).rejects.toBe(failure)
  expect(start).not.toHaveBeenCalled();expect(handle).not.toHaveBeenCalled();await worker.close();await app.close()
})
it('includes shared startup in the budget and prevents handler entry after late startup',async () => {
  const gate=deferred(),handle=vi.fn(),app=new Longhorn().onStart(() => gate.promise)
  const worker=createScheduledWorker(app,{ timeoutMs: 10,handle }),pending=worker.scheduled(controller(),{},context())
  const observed=expect(pending).rejects.toMatchObject({ name: 'ScheduledTimeoutError' })
  await vi.waitFor(() => expect(worker.stats().timedOut).toBe(1));expect(handle).not.toHaveBeenCalled()
  gate.resolve();await observed;expect(app.state).toBe('running');await worker.close();await app.close()
})
it('rejects invalid metadata/configuration and admits the next sequential call at capacity one',async () => {
  const app=new Longhorn(),handle=vi.fn(),worker=createScheduledWorker(app,{ handle,maxConcurrent: 1 })
  for (const event of [{ ...controller(),scheduledTime: -1 },{ ...controller(),cron: 'invalid\nmetadata' }]) await expect(worker.scheduled(event,{},context())).rejects.toMatchObject({ name: 'ScheduledInputError' })
  for (let index=0;index<3;index++) await worker.scheduled(controller(),{},context())
  expect(handle).toHaveBeenCalledTimes(3);expect(worker.stats()).toMatchObject({ active: 0,rejected: 2,succeeded: 3 })
  expect(() => createScheduledWorker(app,{ handle,maxConcurrent: 0 })).toThrow('maxConcurrent')
  expect(() => createScheduledWorker(app,{ handle,timeoutMs: 0 })).toThrow('timeoutMs');await worker.close();await app.close()
})
it('retains ownership through awaited final work such as telemetry flush',async () => {
  const flushing=deferred(),release=deferred(),app=new Longhorn(),worker=createScheduledWorker(app,{ handle: async () => {
    try { await Promise.resolve() } finally { flushing.resolve();await release.promise }
  } })
  const pending=worker.scheduled(controller(),{},context());await flushing.promise
  const closing=worker.close();await Promise.resolve();expect(worker.stats().closed).toBe(false)
  release.resolve();await pending;await closing;await app.close()
})
