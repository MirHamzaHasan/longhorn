import { defineEvent, EventBus } from './index.js'

// Compile-only contracts. Wrong payloads must not widen the event's generic type.
function verifyEventTypes(): void {
  const Created = defineEvent<{ readonly id: string }>('created')
  const NumberEvent = defineEvent<number>('number')
  const bus = new EventBus()
  void bus.emit(Created, { id: 'ok' })
  // @ts-expect-error Payload id must be a string.
  void bus.emit(Created, { id: 12 })
  // @ts-expect-error Payload cannot be inferred from the second argument.
  void bus.emit(NumberEvent, 'bad')
  // @ts-expect-error Event identity is invariant in its payload type.
  const changedType: typeof NumberEvent = Created
  bus.on(Created, (payload, context) => {
    const id: string = payload.id
    // @ts-expect-error Known event payloads are not widened by callback types.
    const invalid: number = payload.id
    // @ts-expect-error Context follow-ups retain their payload contracts.
    void context.emit(Created, { id: 12 })
  })
  // @ts-expect-error Listener payload must match the descriptor.
  bus.scope().on(Created, (value: number) => {})
}
