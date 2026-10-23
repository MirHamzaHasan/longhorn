import { expect,it,vi } from 'vitest'
import { Longhorn } from './application.js'
function deferred<T>() { let resolve!: (value: T) => void;const promise=new Promise<T>(done => { resolve=done });return { promise,resolve } }
it('starts once across HTTP and managed work while preserving return values and original errors',async () => {
  const started=vi.fn(),app=new Longhorn().onStart(started)
  app.http.get('/',c => c.text('ready'))
  const [result,response]=await Promise.all([app.run(() => 42),app.fetch(new Request('http://localhost/'))])
  expect(result).toBe(42);expect(await response.text()).toBe('ready');expect(started).toHaveBeenCalledTimes(1)
  const original={ reason: 'domain failure' };await expect(app.run(() => { throw original })).rejects.toBe(original)
  await app.close();await expect(app.run(() => 0)).rejects.toThrow('closed')
})
it('keeps resources alive until accepted non-HTTP callbacks and awaited children settle',async () => {
  const entered=deferred<void>(),release=deferred<void>(),events: string[]=[],app=new Longhorn().onStart(() => () => { events.push('released') })
  const work=app.run(async () => { entered.resolve();await release.promise;events.push('worked');return 42 })
  await entered.promise;const closing=app.close();await Promise.resolve();expect(events).toEqual([])
  await expect(app.run(() => {})).rejects.toThrow('closing')
  release.resolve();expect(await work).toBe(42);await closing;expect(events).toEqual(['worked','released'])
})
it('does not execute queued work after startup failure or shutdown during startup',async () => {
  const gate=deferred<void>(),handler=vi.fn(),app=new Longhorn().onStart(() => gate.promise)
  const pending=app.run(handler),observed=expect(pending).rejects.toThrow('closing'),closing=app.close()
  gate.resolve();await observed;await closing;expect(handler).not.toHaveBeenCalled()
  const failure=new Error('startup failed'),broken=new Longhorn().onStart(() => { throw failure })
  await expect(broken.run(handler)).rejects.toBe(failure);expect(handler).not.toHaveBeenCalled();await broken.close()
})
