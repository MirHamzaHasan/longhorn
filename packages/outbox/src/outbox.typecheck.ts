import type { Outbox, MessagePublisher } from './index.js'
declare const outbox: Outbox<{ commandId: string }>
declare const publisher: MessagePublisher<{ commandId: string }>
void outbox.enqueue({ commandId: 'one' }); void outbox.dispatchOnce(publisher)
// @ts-expect-error Payload cannot widen the declared schema output
void outbox.enqueue({ commandId: 123 })
// @ts-expect-error Publisher must accept this payload contract
void outbox.dispatchOnce({ async publish(message: { data: { other: number } }) { void message } })
void outbox.list({ state: 'failed', limit: 20 })
void outbox.retryFailed('one', { expectedMaxAttempts: 3, additionalAttempts: 2 })
// @ts-expect-error A retry requires the observed revision/attempt ceiling
void outbox.retryFailed('one', { additionalAttempts: 2 })
// @ts-expect-error State inspection is bounded to known durable states
void outbox.list({ state: 'published' })
void outbox.retryFailedAudited('one', { expectedMaxAttempts: 3, actor: 'user:42', reason: 'provider-restored' })
void outbox.auditHistory({ deliveryId: 'one', limit: 20 })
// @ts-expect-error Audited actions require server-derived attribution and a reason code
void outbox.retryFailedAudited('one', { expectedMaxAttempts: 3 })
// @ts-expect-error Audit cursor has a delivery filter context, not a delivery-state filter
void outbox.auditHistory({ after: { queue: 'outbox.one', state: 'failed', createdAt: 1, id: 'id' } })
