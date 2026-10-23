import { expect, it, vi } from 'vitest'
import { defineEvent, EventBus, EventBusClosedError, EventContextExpiredError, EventDispatchError } from './index.js'
import type { EventContext } from './index.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
const Changed = defineEvent<{ readonly value: number }>('changed')
const Followup = defineEvent<string>('followup')

it('uses frozen typed identities rather than names for routing', async () => {
  const sameName = defineEvent<number>(' changed ')
  expect(sameName.name).toBe('changed')
  expect(sameName.id).not.toBe(Changed.id)
  expect(Object.isFrozen(sameName)).toBe(true)
  expect(() => defineEvent('  ')).toThrow('empty')
  const bus = new EventBus()
  const listener = vi.fn()
  bus.on(Changed, listener)
  expect((await bus.emit(sameName, 1)).listenerCount).toBe(0)
  expect(listener).not.toHaveBeenCalled()
  await bus.close()
})

it('starts in a microtask and awaits listeners in registration order', async () => {
  const bus = new EventBus()
  const gate = deferred()
  const entered = deferred()
  const trace: number[] = []
  bus.on(Changed, async ({ value }) => { trace.push(value); entered.resolve(); await gate.promise; trace.push(2) })
  bus.on(Changed, () => { trace.push(3) })
  const emission = bus.emit(Changed, { value: 1 })
  expect(trace).toEqual([])
  await entered.promise
  expect(trace).toEqual([1])
  gate.resolve()
  expect((await emission).listenerCount).toBe(2)
  expect(trace).toEqual([1, 2, 3])
  await bus.close()
})

it('does not serialize independent emissions behind one another', async () => {
  const bus = new EventBus()
  const entered = deferred()
  const gate = deferred()
  bus.on(Changed, async ({ value }) => { if (value === 1) { entered.resolve(); await gate.promise } })
  const slow = bus.emit(Changed, { value: 1 })
  await entered.promise
  expect((await bus.emit(Changed, { value: 2 })).listenerCount).toBe(1)
  gate.resolve(); await slow; await bus.close()
})

it('reserves a once-listener at admission across concurrent and recursive emits', async () => {
  const bus = new EventBus()
  const values: number[] = []
  bus.once(Changed, async ({ value }) => { values.push(value); await bus.emit(Changed, { value: 3 }) })
  const first = bus.emit(Changed, { value: 1 })
  expect(bus.listenerCount(Changed)).toBe(0)
  const second = bus.emit(Changed, { value: 2 })
  expect((await first).listenerCount).toBe(1)
  expect((await second).listenerCount).toBe(0)
  expect(values).toEqual([1])
  await bus.close()
})

it('snapshots subscriptions while allowing removals to skip callbacks not yet started', async () => {
  const bus = new EventBus()
  const values: string[] = []
  let installed = false
  let removeSecond = () => {}
  bus.on(Changed, () => {
    values.push('first'); removeSecond()
    if (!installed) { installed = true; bus.on(Changed, () => { values.push('later') }) }
  })
  removeSecond = bus.on(Changed, () => { values.push('second') })
  expect((await bus.emit(Changed, { value: 1 })).listenerCount).toBe(1)
  expect(values).toEqual(['first'])
  await bus.emit(Changed, { value: 2 })
  expect(values).toEqual(['first', 'first', 'later'])
  removeSecond(); removeSecond()
  await bus.close()
})

it('allows disposing a reserved once-listener before it starts', async () => {
  const bus = new EventBus()
  const listener = vi.fn()
  const dispose = bus.once(Changed, listener)
  const emission = bus.emit(Changed, { value: 1 })
  dispose(); dispose()
  expect((await emission).listenerCount).toBe(0)
  expect(listener).not.toHaveBeenCalled()
  await bus.close()
})

it('supports AbortSignal ownership and releases signal bindings after once delivery', async () => {
  const bus = new EventBus()
  const early = new AbortController(); early.abort()
  bus.on(Changed, () => { throw new Error('never') }, { signal: early.signal })
  expect(bus.listenerCount(Changed)).toBe(0)
  const controller = new AbortController()
  const removed = vi.spyOn(controller.signal, 'removeEventListener')
  const scoped = bus.scope()
  scoped.once(Changed, (_, context) => { expect(context.signal).toBe(controller.signal) }, { signal: controller.signal })
  await bus.emit(Changed, { value: 1 })
  expect(removed).toHaveBeenCalledWith('abort', expect.any(Function))
  expect(bus.listenerCount(Changed)).toBe(0)
  const next = new AbortController()
  const listener = vi.fn()
  scoped.on(Changed, listener, { signal: next.signal })
  const queued = bus.emit(Changed, { value: 2 })
  next.abort()
  await queued
  expect(listener).not.toHaveBeenCalled()
  await scoped.close(); await bus.close()
})

it('retains the original signal when a caller mutates its options object', async () => {
  const bus = new EventBus()
  const original = new AbortController(); const replacement = new AbortController()
  const removed = vi.spyOn(original.signal, 'removeEventListener')
  const options = { signal: original.signal }
  const off = bus.on(Changed, () => {}, options)
  options.signal = replacement.signal
  off()
  expect(removed).toHaveBeenCalledWith('abort', expect.any(Function))
  expect(bus.listenerCount(Changed)).toBe(0)
  await bus.close()
})

it('aggregates synchronous and asynchronous failures after attempting later listeners', async () => {
  const bus = new EventBus()
  const first = new Error('first')
  const last = vi.fn()
  bus.on(Changed, () => { throw first })
  bus.on(Changed, async () => { throw 'second' })
  bus.on(Changed, last)
  try {
    await bus.emit(Changed, { value: 1 })
    throw new Error('Expected rejection')
  } catch (error) {
    expect(error).toBeInstanceOf(EventDispatchError)
    expect(error).toMatchObject({ eventName: 'changed', errors: [first, 'second'], eventId: expect.any(String) })
  }
  expect(last).toHaveBeenCalledTimes(1)
  await bus.close()
})

it('gives immutable per-dispatch metadata and inherited correlation to follow-ups', async () => {
  const bus = new EventBus()
  let parent!: EventContext
  let child!: EventContext
  bus.on(Changed, async (_, context) => { parent = context; await context.emit(Followup, 'child') })
  bus.on(Followup, (_, context) => { child = context })
  const options = { correlationId: 'request-123' }
  const emitting = bus.emit(Changed, { value: 1 }, options)
  options.correlationId = 'mutated'
  const result = await emitting
  expect(parent.id).toBe(result.eventId)
  expect(Object.isFrozen(parent)).toBe(true)
  expect(child.parentId).toBe(parent.id)
  expect(child.id).not.toBe(parent.id)
  expect(child.correlationId).toBe('request-123')
  expect(Number.isSafeInteger(parent.emittedAt)).toBe(true)
  await expect(parent.emit(Followup, 'too late')).rejects.toBeInstanceOf(EventContextExpiredError)
  await bus.close()
})

it('closes a scope by unsubscribing immediately and draining its running callbacks', async () => {
  const bus = new EventBus()
  const scope = bus.scope()
  const entered = deferred(); const gate = deferred()
  let finished = false
  scope.on(Changed, async () => { entered.resolve(); await gate.promise; finished = true })
  const emission = bus.emit(Changed, { value: 1 })
  await entered.promise
  const closing = scope.close()
  expect(scope.close()).toBe(closing)
  expect(scope.state).toBe('closing')
  expect(bus.listenerCount(Changed)).toBe(0)
  expect(() => scope.on(Changed, () => {})).toThrow('scope')
  expect((await bus.emit(Changed, { value: 2 })).listenerCount).toBe(0)
  expect(finished).toBe(false)
  gate.resolve(); await emission; await closing
  expect(finished).toBe(true)
  expect(scope.state).toBe('closed')
  expect(bus.state).toBe('open')
  await bus.close()
})

it('cancels a scoped once reservation that has not started', async () => {
  const bus = new EventBus()
  const scope = bus.scope()
  const listener = vi.fn()
  scope.once(Changed, listener)
  const emission = bus.emit(Changed, { value: 1 })
  await scope.close()
  expect((await emission).listenerCount).toBe(0)
  expect(listener).not.toHaveBeenCalled()
  await bus.close()
})

it('drains accepted deliveries on close while refusing new root work and subscriptions', async () => {
  const bus = new EventBus()
  const scope = bus.scope()
  const entered = deferred(); const gate = deferred()
  const seen: string[] = []
  scope.on(Changed, async () => { entered.resolve(); await gate.promise; seen.push('first') })
  scope.on(Changed, () => { seen.push('second') })
  const emission = bus.emit(Changed, { value: 1 })
  await entered.promise
  const closing = bus.close()
  expect(bus.close()).toBe(closing)
  expect(bus.state).toBe('closing')
  expect(() => bus.on(Changed, () => {})).toThrow(EventBusClosedError)
  expect(() => bus.scope()).toThrow(EventBusClosedError)
  await expect(bus.emit(Changed, { value: 2 })).rejects.toBeInstanceOf(EventBusClosedError)
  expect(seen).toEqual([])
  gate.resolve(); await emission; await closing
  expect(seen).toEqual(['first', 'second'])
  expect(scope.state).toBe('closed')
  expect(bus.state).toBe('closed')
  expect(bus.listenerCount(Changed)).toBe(0)
})

it('allows context-owned child work to join the drain after root admission closes', async () => {
  const bus = new EventBus()
  const entered = deferred(); const gate = deferred(); const childGate = deferred(); const childEntered = deferred()
  let completed = false
  bus.on(Changed, async (_, context) => { entered.resolve(); await gate.promise; await context.emit(Followup, 'child') })
  bus.on(Followup, async () => { childEntered.resolve(); await childGate.promise; completed = true })
  const emission = bus.emit(Changed, { value: 1 })
  await entered.promise
  const closing = bus.close()
  gate.resolve(); await childEntered.promise
  expect(bus.state).toBe('closing')
  expect(completed).toBe(false)
  childGate.resolve(); await emission; await closing
  expect(completed).toBe(true)
})

it('leaves delivery errors with emit while still completing bus and scope cleanup', async () => {
  const bus = new EventBus()
  const scope = bus.scope()
  const entered = deferred(); const gate = deferred()
  scope.on(Changed, async () => { entered.resolve(); await gate.promise; throw new Error('delivery failed') })
  const rejected = expect(bus.emit(Changed, { value: 1 })).rejects.toBeInstanceOf(EventDispatchError)
  await entered.promise
  const closing = bus.close()
  gate.resolve(); await rejected; await closing
  expect(scope.state).toBe('closed')
})

it('keeps duplicate callback subscriptions independent and removes all on shutdown', async () => {
  const bus = new EventBus()
  const callback = vi.fn()
  const remove = bus.on(Changed, callback)
  bus.on(Changed, callback)
  await bus.emit(Changed, { value: 1 })
  expect(callback).toHaveBeenCalledTimes(2)
  remove()
  await bus.emit(Changed, { value: 2 })
  expect(callback).toHaveBeenCalledTimes(3)
  await bus.close()
  expect(bus.listenerCount(Changed)).toBe(0)
})

it('does not consume a once subscription for invalid dispatch metadata', async () => {
  const bus = new EventBus()
  bus.once(Changed, () => {})
  await expect(bus.emit(Changed, { value: 1 }, { correlationId: '' })).rejects.toThrow('correlation')
  expect(bus.listenerCount(Changed)).toBe(1)
  expect((await bus.emit(Changed, { value: 1 })).listenerCount).toBe(1)
  await bus.close()
})
