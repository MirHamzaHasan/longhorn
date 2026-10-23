import { expect, it } from 'vitest'
import { createQueuePublisher } from './outbox.js'
it('awaits actual queue acceptance and sends the original stable envelope as JSON', async () => {
  let release!: () => void, calls = 0, settled = false
  const gate = new Promise<void>(resolve => { release = resolve }), message = { id: 'stable', topic: 'events.v1', data: { value: 2 } }
  const publisher = createQueuePublisher({ async send(body, options) { expect(body).toBe(message); expect(options).toEqual({ contentType: 'json' }); calls++; await gate } })
  const controller = new AbortController(), pending = publisher.publish(message, { signal: controller.signal }).then(() => { settled = true })
  expect(calls).toBe(1); expect(settled).toBe(false); release(); await pending; expect(settled).toBe(true)
})
it('checks cancellation without abandoning an already running uncancellable send', async () => {
  let release!: () => void, sent = 0, settled = false
  const gate = new Promise<void>(resolve => { release = resolve }), publisher = createQueuePublisher({ async send() { sent++; await gate } })
  const controller = new AbortController(), message = { id: 'same', topic: 'events.v1', data: {} }
  const pending = publisher.publish(message, { signal: controller.signal }).finally(() => { settled = true })
  const rejected = expect(pending).rejects.toThrow('owned abort')
  controller.abort(new Error('owned abort')); expect(settled).toBe(false); release(); await rejected; expect(sent).toBe(1)
  await expect(publisher.publish(message, { signal: controller.signal })).rejects.toThrow('owned abort'); expect(sent).toBe(1)
})
