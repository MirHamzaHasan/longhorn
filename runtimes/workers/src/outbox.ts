/** Structural binding/port: optional adapter does not import an application or a queue implementation. */
export interface QueueProducerBinding {
  send(body: unknown, options: { readonly contentType: 'json' }): Promise<unknown>
}
export type QueuePublisher<T> = {
  publish(message: { readonly id: string; readonly topic: string; readonly data: T }, context: { readonly signal: AbortSignal }): Promise<void>
}
/** Sends the stable application message ID in the JSON envelope; the broker assigns its own delivery ID. */
export function createQueuePublisher<T>(binding: QueueProducerBinding): QueuePublisher<T> {
  if (typeof binding?.send !== 'function') throw new Error('A queue producer binding is required')
  return { async publish(message, context) {
    context.signal.throwIfAborted()
    await binding.send(message, { contentType: 'json' })
    // An uncancellable send still retains caller ownership until its real result settles.
    context.signal.throwIfAborted()
  } }
}
