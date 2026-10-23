import { Longhorn } from '@longhorn/core'
import { token, provide } from '@longhorn/container'
import type { Logger } from '@longhorn/logger'
import { validate } from '@longhorn/validation/hono'
import { z } from 'zod'
import { EventBus, defineEvent } from '@longhorn/events'
import { Cache } from '@longhorn/cache'
import { MemoryCacheStore } from '@longhorn/cache/memory'
import { configureDiagnostics } from './diagnostics.js'

export type PortableBindings = {
  GREETING?: string
  AUDIT?: { put(key: string, value: string): Promise<void>; get(key: string): Promise<string | null> }
}

const State = token<{ runtime: string; ready: boolean }>('portable application state')
const Events = token<EventBus>('portable events')
const Echoed = defineEvent<{ readonly runtime: string }>('portable.echoed')
type Profile = { readonly runtime: string; readonly generatedAt: string }
const ProfileCache = token<Cache<Profile>>('portable public profile cache')

export function createPortableApp(runtime: string, logger?: Logger): Longhorn<PortableBindings> {
  const state = { runtime, ready: false }
  const activity = { echoes: 0, requestId: null as string | null }
  const app = new Longhorn<PortableBindings>(logger ? { logger } : {})
  app.container.register(provide(State, { factory: () => state }))
  app.container.register(provide(Events, { factory: () => new EventBus() }))
  app.container.register(provide(ProfileCache, { factory: () => new Cache<Profile>(new MemoryCacheStore<Profile>(), { ttlMs: 5000 }) }))
  app.onStart(() => {
    state.ready = true
    return () => { state.ready = false }
  })
  app.onStart(() => {
    const cache = app.container.resolve(ProfileCache)
    return () => cache.close()
  })
  app.onStart(() => {
    const events = app.container.resolve(Events)
    const scope = events.scope()
    scope.on(Echoed, async (_, context) => {
      await Promise.resolve()
      activity.echoes++
      activity.requestId = context.correlationId ?? null
    })
    return () => events.close()
  })
  configureDiagnostics(app, () => state.ready)
  app.http.get('/health', (c) => c.json({ status: 'ok', ...c.get('container').resolve(State) }))
  app.http.get('/', (c) => c.json({ runtime, greeting: c.env?.GREETING ?? 'Hello from LongHorn' }))
  app.http.get('/events', (c) => c.json({ events: { ...activity } }))
  app.http.get('/cached', async (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(await c.get('container').resolve(ProfileCache).getOrLoad('profile', async () => ({ runtime, generatedAt: new Date().toISOString() })))
  })
  app.http.post('/cached/invalidate', async (c) => { await c.get('container').resolve(ProfileCache).delete('profile'); return c.body(null, 204) })
  app.http.post('/echo', validate('json', z.object({ message: z.string().trim().min(1).max(200) })), async (c) => {
    await c.get('container').resolve(Events).emit(Echoed, { runtime }, { correlationId: c.get('requestId') })
    return c.json({ message: c.req.valid('json').message, ...c.get('container').resolve(State) })
  })
  app.http.get('/failure', () => { throw new Error('Expected portable example failure') })
  return app
}
