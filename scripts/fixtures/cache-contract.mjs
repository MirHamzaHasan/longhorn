import { Cache, CacheClosedError } from '../../packages/cache/dist/index.js'
import { MemoryCacheStore } from '../../packages/cache/dist/memory.js'

function assert(value, message) { if (!value) throw new Error(message) }
function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

/** The same built package runs in Node, Bun, Deno, and workerd. */
export async function verifyCache() {
  let now = 1000
  const memory = new MemoryCacheStore({ maxEntries: 4, clock: () => now })
  const cache = new Cache(memory, { ttlMs: 10 })
  await cache.set('undefined', undefined)
  assert((await cache.get('undefined')).hit, 'Cached undefined became a miss')
  now = 1010
  assert(!(await cache.get('undefined')).hit, 'TTL boundary did not expire')
  const entered = deferred(); const gate = deferred()
  let loads = 0
  const load = async () => { loads++; entered.resolve(); await gate.promise; return { value: 1 } }
  const first = cache.getOrLoad('key', load)
  await entered.promise
  const shared = cache.getOrLoad('key', load)
  gate.resolve()
  const [one, two] = await Promise.all([first, shared])
  assert(loads === 1, 'Concurrent misses did not share loading')
  one.value = 5
  assert(two.value === 1 && (await cache.get('key')).value.value === 1, 'Value copies were not isolated')
  const oldEntered = deferred(); const oldGate = deferred()
  const old = cache.getOrLoad('race', async () => { oldEntered.resolve(); await oldGate.promise; return 1 })
  await oldEntered.promise
  await cache.delete('race')
  assert(await cache.getOrLoad('race', async () => 2) === 2, 'New generation joined stale work')
  oldGate.resolve(); assert(await old === 1, 'Waiting caller lost its accepted source result')
  assert((await cache.get('race')).value === 2, 'Older load repopulated invalidated data')
  const closingEntered = deferred(); const closingGate = deferred()
  const pending = cache.getOrLoad('closing', async () => { closingEntered.resolve(); await closingGate.promise; return 3 })
  await closingEntered.promise
  const closing = cache.close()
  assert(cache.close() === closing, 'Close result was not shared')
  try { await cache.get('race'); throw new Error('Expected closed rejection') }
  catch (error) { assert(error instanceof CacheClosedError, 'New work entered a closing cache') }
  closingGate.resolve(); assert(await pending === 3, 'Accepted loader did not drain')
  await closing
  assert(cache.state === 'closed', 'Cache did not close')
  return { verified: true, loads, isolated: true, invalidated: true, drained: true }
}
