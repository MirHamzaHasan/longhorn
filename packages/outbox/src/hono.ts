import { Hono } from 'hono'
import type { Context, Env } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { SqlExecutor } from '@longhorn/database'
import type { Outbox, DeliveryCursor, RecoveryAuditCursor } from './index.js'
import { validate } from '@longhorn/validation/hono'
import { z } from 'zod'

export type OperationsIdentity = { readonly actor: string }
export type OutboxOperationsOptions<T, E extends Env> = {
  readonly resolve: (context: Context<E>) => Outbox<T> | Promise<Outbox<T>>
  /** Required gate runs before query/body validation. Choose 401/403 policy in the application. */
  readonly authorize: (context: Context<E>, action: 'inspect' | 'retry') => OperationsIdentity | Response | Promise<OperationsIdentity | Response>
  /** Optional SQL/session policy recheck inside the retry/audit transaction. Throw to deny without an audit. */
  readonly authorizeRetry?: (context: Context<E>, transaction: SqlExecutor) => Promise<OperationsIdentity>
  readonly location?: (id: string) => string
}

const states = z.enum(['pending','running','succeeded','failed'])
const cursor = z.object({ queue: z.string().min(1).max(100), state: states, createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), id: z.uuid() }).strict()
const query = z.object({ state: states.default('failed'), limit: z.string().regex(/^\d+$/).default('50').transform(Number).pipe(z.number().int().min(1).max(100)),
  after: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional() }).strict()
const retry = z.object({ expectedMaxAttempts: z.number().int().min(1).max(100), additionalAttempts: z.number().int().min(1).max(100).default(3), delayMs: z.number().int().min(0).max(86_400_000).default(0),
  reason: z.enum(['manual-retry','provider-restored','configuration-fixed','investigating']).default('manual-retry') }).strict()
const auditCursor = z.object({ queue: z.string().min(1).max(100), deliveryId: z.uuid().nullable(), createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), id: z.uuid() }).strict()
const auditQuery = z.object({ deliveryId: z.uuid().optional(), limit: query.shape.limit, after: query.shape.after }).strict()
const params = z.object({ id: z.uuid() })
const encode = (value: DeliveryCursor | RecoveryAuditCursor) => btoa(JSON.stringify(value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')

export function createOutboxOperations<T, E extends Env = Env>(options: OutboxOperationsOptions<T, E>): Hono<E> {
  if (typeof options.authorize !== 'function' || typeof options.resolve !== 'function') throw new Error('Operations require an authorizer and an outbox resolver')
  const router = new Hono<E>(), identities = new WeakMap<object, OperationsIdentity & { context: Context<E> }>()
  // Hono intersects validator environments. Retain the original typed context at admission
  // so application callbacks keep E without casting the validated route context.
  const admitted = (context: object) => {
    const identity = identities.get(context)
    if (!identity) throw new Error('Operations authorization did not run')
    return identity
  }
  router.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    const principal = await options.authorize(c, c.req.method === 'POST' ? 'retry' : 'inspect')
    if (principal instanceof Response) return principal
    if (!principal || typeof principal.actor !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(principal.actor)) throw new Error('Invalid operations principal')
    identities.set(c, Object.freeze({ actor: principal.actor, context: c }))
    await next()
  })
  router.get('/deliveries', validate('query', query), async c => {
    const input = c.req.valid('query'), outgoing = await options.resolve(admitted(c).context)
    let after: DeliveryCursor | undefined
    if (input.after) {
      try {
        const parsed = cursor.safeParse(JSON.parse(atob(input.after.replace(/-/g,'+').replace(/_/g,'/'))))
        if (!parsed.success || parsed.data.queue !== outgoing.queueName || parsed.data.state !== input.state) return c.json({ error: 'Invalid delivery cursor' }, 400)
        after = parsed.data
      } catch { return c.json({ error: 'Invalid delivery cursor' }, 400) }
    }
    const page = await outgoing.list({ state: input.state, limit: input.limit, ...(after ? { after } : {}) })
    return c.json({ deliveries: page.deliveries, nextCursor: page.nextCursor ? encode(page.nextCursor) : null })
  })
  router.get('/deliveries/:id', validate('param', params), async c => {
    const delivery = await (await options.resolve(admitted(c).context)).get(c.req.valid('param').id)
    return delivery ? c.json({ delivery }) : c.json({ error: 'Delivery not found' }, 404)
  })
  router.post('/deliveries/:id/retry', validate('param', params), validate('json', retry), async c => {
    const identity = admitted(c), outgoing = await options.resolve(identity.context), input = c.req.valid('json'), id = c.req.valid('param').id
    const { result, audit } = options.authorizeRetry
      ? await outgoing.retryFailedAuthorized(id, input, async tx => {
        const principal = await options.authorizeRetry!(identity.context, tx)
        if (principal.actor !== identity.actor) throw new HTTPException(401, { message: 'Operations principal changed' })
        return principal
      })
      : await outgoing.retryFailedAudited(id, { ...input, actor: identity.actor })
    if (result.status === 'missing') return c.json({ error: 'Delivery not found', audit }, 404)
    if (result.status === 'scheduled') { c.header('Location', options.location ? options.location(result.delivery.id) : '/deliveries/'+result.delivery.id); return c.json({ delivery: result.delivery, audit }, 202) }
    return c.json({ error: result.status === 'budget-exhausted' ? 'Attempt ceiling cannot exceed 100' : 'Delivery changed or is not failed', delivery: result.delivery, audit }, 409)
  })
  router.get('/audit', validate('query', auditQuery), async c => {
    const input = c.req.valid('query'), outgoing = await options.resolve(admitted(c).context)
    let after: RecoveryAuditCursor | undefined
    if (input.after) {
      try {
        const parsed = auditCursor.safeParse(JSON.parse(atob(input.after.replace(/-/g,'+').replace(/_/g,'/'))))
        if (!parsed.success || parsed.data.queue !== outgoing.queueName || parsed.data.deliveryId !== (input.deliveryId ?? null)) return c.json({ error: 'Invalid audit cursor' }, 400)
        after = parsed.data
      } catch { return c.json({ error: 'Invalid audit cursor' }, 400) }
    }
    const page = await outgoing.auditHistory({ limit: input.limit, ...(input.deliveryId === undefined ? {} : { deliveryId: input.deliveryId }), ...(after ? { after } : {}) })
    return c.json({ records: page.records, nextCursor: page.nextCursor ? encode(page.nextCursor) : null })
  })
  return router
}
