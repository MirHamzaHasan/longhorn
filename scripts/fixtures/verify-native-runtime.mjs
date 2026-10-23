import { Longhorn } from '../../packages/core/dist/index.js'
import * as bunAdapter from '../../runtimes/bun/dist/index.js'
import * as denoAdapter from '../../runtimes/deno/dist/index.js'

function assert(value, message) { if (!value) throw new Error(message) }
async function rejects(work, message) {
  try { await work() } catch { return }
  throw new Error(message)
}

const runtime = typeof Bun === 'undefined' ? 'deno' : 'bun'
const adapter = runtime === 'bun' ? bunAdapter : denoAdapter
const plain = { fetch: (request) => Response.json({ method: request.method }) }
for (const port of [-1, 65536, 1.5, NaN]) {
  await rejects(() => adapter.serve(plain, { port }), `Accepted invalid port ${port}`)
}

let resourceOpen = false
const app = new Longhorn().onStart(() => {
  resourceOpen = true
  return () => { resourceOpen = false }
})
app.http.get('/health', (c) => c.json({ resourceOpen }))
let entered
let release
const incoming = new Promise((resolve) => { entered = resolve })
const gate = new Promise((resolve) => { release = resolve })
app.http.get('/slow', async (c) => {
  entered()
  await gate
  return c.json({ resourceOpen })
})

const server = await app.listen(adapter[`${runtime}Runtime`], { port: 0 })
try {
  assert(server.port > 0, 'Ephemeral port was not reported')
  const health = await fetch(`${server.url}/health`)
  assert((await health.json()).resourceOpen, 'Startup did not precede HTTP')
  assert(health.headers.get('X-Request-Id'), 'Missing request ID')
  await rejects(() => adapter.serve(plain, { port: server.port }), 'Occupied port was accepted')

  const pending = fetch(`${server.url}/slow`)
  await incoming
  const closing = app.close()
  assert(app.close() === closing, 'Shutdown was not idempotent')
  assert(resourceOpen, 'Resource released before active request finished')
  release()
  assert((await (await pending).json()).resourceOpen, 'Active handler lost its resource')
  await closing
  assert(!resourceOpen, 'Resource cleanup did not run')
} finally {
  release()
  await app.close()
}

const replacement = await adapter.serve(plain, { port: server.port })
try {
  assert((await (await fetch(replacement.url)).json()).method === 'GET', 'Rebound listener failed')
} finally {
  const closing = replacement.close()
  assert(replacement.close() === closing, 'Listener close was not idempotent')
  await closing
}

const failure = await adapter.serve({ fetch: () => { throw new Error('Native handler failure') } }, { port: 0 })
try {
  const response = await fetch(failure.url)
  assert(response.status === 500, 'Uncaught handler failure did not return 500')
  assert((await response.json()).error === 'Internal Server Error', 'Handler details leaked to the client')
} finally { await failure.close() }

console.log(JSON.stringify({ runtime, verified: true, checks: ['options', 'startup', 'tcp', 'request-id', 'occupied-port', 'drain', 'cleanup', 'rebind', 'errors'] }))
