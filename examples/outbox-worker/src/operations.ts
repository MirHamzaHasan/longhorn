import type { Longhorn } from '@longhornjs/core'
import type { Outbox } from '@longhornjs/outbox'
import { createOutboxOperations } from '@longhornjs/outbox/hono'
import { createBearerVerifier } from '@longhornjs/auth/bearer'

/** Explicit service-credential policy; the shared routes can also use verified account principals. */
export function configureOperations<T>(app: Longhorn, resolve: () => Outbox<T>, token: string | undefined, actor = 'service:outbox-operations'): void {
  if (token === undefined) return
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('OUTBOX_OPERATIONS_TOKEN must contain 32-256 ASCII token characters')
  if (typeof actor !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(actor)) throw new Error('Invalid OUTBOX_OPERATIONS_ACTOR')
  const authorized = createBearerVerifier(token)
  app.http.route('/operations', createOutboxOperations({
    resolve: () => resolve(),
    authorize: async c => {
      c.header('Vary', 'Authorization', { append: true })
      if (!await authorized(c.req.header('Authorization'))) { c.header('WWW-Authenticate', 'Bearer'); return c.json({ error: 'Authentication required' }, 401) }
      return { actor }
    },
  }))
}
