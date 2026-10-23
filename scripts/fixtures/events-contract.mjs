import { defineEvent, EventBus, EventBusClosedError, EventContextExpiredError, EventDispatchError } from '../../packages/events/dist/index.js'

function assert(value, message) { if (!value) throw new Error(message) }
function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
async function rejects(work, type) {
  try { await work() } catch (error) { assert(error instanceof type, `Wrong rejection: ${error}`); return }
  throw new Error(`Expected ${type.name}`)
}

/** The same built package runs unmodified in Node, Bun, Deno, and workerd. */
export async function verifyEvents() {
  const Parent = defineEvent('parent')
  const Child = defineEvent('child')
  const Cancelled = defineEvent('cancelled')
  const bus = new EventBus()
  const scope = bus.scope()
  const gate = deferred(); const entered = deferred()
  let onceCalls = 0; let observed = 0; let childCalls = 0; let failures = 0
  let parentContext
  const abort = new AbortController()
  scope.on(Cancelled, () => { throw new Error('Aborted subscription ran') }, { signal: abort.signal })
  abort.abort()
  assert(bus.listenerCount(Cancelled) === 0, 'Abort did not remove listener')
  scope.once(Parent, () => { onceCalls++ })
  scope.on(Parent, async (payload, context) => {
    observed++
    if (payload.value !== 1) return
    parentContext = context
    entered.resolve()
    await gate.promise
    try { await context.emit(Child, undefined) } catch (error) {
      assert(error instanceof EventDispatchError, 'Child failure was not aggregated')
      failures = error.errors.length
    }
  })
  scope.on(Child, () => { throw new Error('Expected child observer failure') })
  scope.on(Child, (_, context) => {
    assert(context.parentId === parentContext.id, 'Parent correlation lost')
    assert(context.correlationId === 'fixture-request', 'Request correlation lost')
    childCalls++
  })
  const first = bus.emit(Parent, { value: 1 }, { correlationId: 'fixture-request' })
  const second = bus.emit(Parent, { value: 2 })
  await entered.promise
  await second
  const closing = bus.close()
  assert(bus.close() === closing, 'Close did not share its result')
  await rejects(() => bus.emit(Parent, { value: 3 }), EventBusClosedError)
  gate.resolve()
  await first; await closing
  assert(onceCalls === 1 && observed === 2, 'Concurrent/once dispatch counts differ')
  assert(childCalls === 1 && failures === 1, 'Accepted child work did not drain after failure')
  assert(bus.state === 'closed' && scope.state === 'closed', 'Ownership did not close')
  assert(bus.listenerCount(Parent) === 0 && bus.listenerCount(Child) === 0, 'Listeners leaked')
  await rejects(() => parentContext.emit(Child, undefined), EventContextExpiredError)
  return { verified: true, onceCalls, observed, childCalls, failures }
}
