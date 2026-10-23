import { createWorker } from '@longhorn/workers'
import { createPortableApp } from './app.js'
import type { PortableBindings } from './app.js'
import { createLogger } from '@longhorn/logger'

const app = createPortableApp('workers', createLogger({ bindings: { runtime: 'workers' } }))
app.http.get('/background', (c) => {
  const audit = c.env.AUDIT
  if (!audit) return c.json({ error: 'AUDIT binding is not configured' }, 503)
  const requestId = c.get('requestId')
  c.executionCtx.waitUntil((async () => {
    await new Promise((resolve) => setTimeout(resolve, 25))
    await audit.put('last-request', requestId)
  })())
  return c.json({ queued: requestId })
})
app.http.get('/audit', async (c) => c.json({ requestId: await c.env.AUDIT?.get('last-request') ?? null }))

export default createWorker<PortableBindings>(app)
