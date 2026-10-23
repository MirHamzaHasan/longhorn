import type { Idempotency, JsonValue } from './index.js'
declare const service: Idempotency
const input: JsonValue = { title: 'typed intent', tags: ['one', 'two'], enabled: true }
const result = service.run({ scope: 'tenant:1:tasks:v1', key: 'key', input }, async tx => {
  await tx.execute({ sql: 'SELECT ?', args: [1] })
  return { id: '1', nested: { count: 2 } }
})
void result.then(outcome => { const id: string = outcome.value.id; void id })
// @ts-expect-error BigInt is not JSON input
void service.run({ scope: 'tasks:v1', key: 'key', input: { id: 1n } }, async () => ({}))
// @ts-expect-error JSON results cannot silently discard undefined
void service.run({ scope: 'tasks:v1', key: 'key', input }, async () => ({ invalid: undefined }))
// @ts-expect-error Missing client key
void service.run({ scope: 'tasks:v1', input }, async () => ({}))
