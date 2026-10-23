import type { DispatchOptions, DispatchResult, EventContext, EventListener, EventScope, EventType, SubscribeOptions } from './event.js'

type State = 'open' | 'closing' | 'closed'
type Owner = { state: State; listeners: Set<Subscription>; running: Set<Promise<void>>; closing?: Promise<void> }
type Subscription = {
  eventId: symbol
  active: boolean
  once: boolean
  listener: EventListener<unknown>
  dispose: () => void
  owner?: Owner
  signal?: AbortSignal
}

export class EventBusClosedError extends Error {
  constructor() { super('Event bus is closing or closed'); this.name = 'EventBusClosedError' }
}
export class EventContextExpiredError extends Error {
  constructor() { super('Event dispatch context has finished'); this.name = 'EventContextExpiredError' }
}
export class EventDispatchError extends AggregateError {
  constructor(readonly eventId: string, readonly eventName: string, errors: readonly unknown[]) {
    super(errors, `Event delivery failed: ${eventName}`)
    this.name = 'EventDispatchError'
  }
}

/** In-process asynchronous events. No native APIs, persistence, or hidden workers. */
export class EventBus {
  private current: State = 'open'
  private readonly listeners = new Map<symbol, Set<Subscription>>()
  private readonly owners = new Set<Owner>()
  // Completion signals deliberately do not consume the caller's emit rejection.
  private readonly pending = new Set<Promise<void>>()
  private closing: Promise<void> | undefined

  get state(): State { return this.current }

  on<T>(type: EventType<T>, listener: EventListener<NoInfer<T>>, options: SubscribeOptions = {}): () => void {
    return this.subscribe(type, listener, false, options)
  }
  once<T>(type: EventType<T>, listener: EventListener<NoInfer<T>>, options: SubscribeOptions = {}): () => void {
    return this.subscribe(type, listener, true, options)
  }
  listenerCount<T>(type: EventType<T>): number { return this.listeners.get(type.id)?.size ?? 0 }

  scope(): EventScope {
    this.assertOpen()
    const owner: Owner = { state: 'open', listeners: new Set(), running: new Set() }
    this.owners.add(owner)
    return Object.freeze({
      get state() { return owner.state },
      on: <T>(type: EventType<T>, listener: EventListener<NoInfer<T>>, options: SubscribeOptions = {}) =>
        this.subscribe(type, listener, false, options, owner),
      once: <T>(type: EventType<T>, listener: EventListener<NoInfer<T>>, options: SubscribeOptions = {}) =>
        this.subscribe(type, listener, true, options, owner),
      close: () => this.closeOwner(owner),
    })
  }

  async emit<T>(type: EventType<T>, payload: NoInfer<T>, options: DispatchOptions = {}): Promise<DispatchResult> {
    this.assertOpen()
    return this.dispatch(type, payload, options)
  }

  close(): Promise<void> {
    this.closing ??= this.shutdown()
    return this.closing
  }

  private assertOpen(): void { if (this.current !== 'open') throw new EventBusClosedError() }

  private subscribe<T>(type: EventType<T>, listener: EventListener<T>, once: boolean, options: SubscribeOptions, owner?: Owner): () => void {
    this.assertOpen()
    if (owner && owner.state !== 'open') throw new Error('Event scope is closing or closed')
    if (typeof type?.id !== 'symbol' || typeof type.name !== 'string') throw new TypeError('Invalid event type')
    if (typeof listener !== 'function') throw new TypeError('Event listener must be a function')
    const signal = options.signal
    if (signal?.aborted) return () => {}
    const group = this.listeners.get(type.id) ?? new Set<Subscription>()
    const subscription: Subscription = {
      eventId: type.id, active: true, once, listener: listener as EventListener<unknown>,
      ...(owner ? { owner } : {}), ...(signal ? { signal } : {}),
      dispose: () => {
        if (!subscription.active) return
        subscription.active = false
        this.unlink(subscription)
        owner?.listeners.delete(subscription)
        signal?.removeEventListener('abort', subscription.dispose)
      },
    }
    group.add(subscription)
    this.listeners.set(type.id, group)
    owner?.listeners.add(subscription)
    signal?.addEventListener('abort', subscription.dispose, { once: true })
    return subscription.dispose
  }

  /** Remove routing without cancelling a once-listener already reserved by emit. */
  private unlink(subscription: Subscription): void {
    const group = this.listeners.get(subscription.eventId)
    group?.delete(subscription)
    if (!group?.size) this.listeners.delete(subscription.eventId)
  }

  private dispatch<T>(type: EventType<T>, payload: T, options: DispatchOptions, parent?: { id: string; active: boolean }): Promise<DispatchResult> {
    if (parent && !parent.active) return Promise.reject(new EventContextExpiredError())
    if (this.current === 'closed' || (this.current === 'closing' && !parent?.active)) {
      return Promise.reject(new EventBusClosedError())
    }
    if (typeof type?.id !== 'symbol' || typeof type.name !== 'string') return Promise.reject(new TypeError('Invalid event type'))
    const correlationId = options.correlationId
    if (correlationId !== undefined && (typeof correlationId !== 'string' || !correlationId)) {
      return Promise.reject(new TypeError('Event correlation ID must be a nonempty string'))
    }
    const id = crypto.randomUUID()
    const dispatch = { id, active: true }
    const inherited = Object.freeze(correlationId ? { correlationId } : {})
    const context = Object.freeze({
      id, name: type.name, emittedAt: Date.now(),
      ...inherited,
      ...(parent ? { parentId: parent.id } : {}),
      emit: async <U>(next: EventType<U>, value: NoInfer<U>) => this.dispatch(next, value, inherited, dispatch),
    })
    const snapshot = [...(this.listeners.get(type.id) ?? [])]
    // Reserve every once-listener before user code or another emit can run.
    for (const subscription of snapshot) if (subscription.once) this.unlink(subscription)
    let finish!: () => void
    const completion = new Promise<void>((resolve) => { finish = resolve })
    this.pending.add(completion)
    return this.deliver(snapshot, payload, context, dispatch, () => {
      this.pending.delete(completion)
      finish()
    })
  }

  private async deliver<T>(snapshot: Subscription[], payload: T, context: EventContext,
    dispatch: { active: boolean }, finish: () => void): Promise<DispatchResult> {
    const errors: unknown[] = []
    let count = 0
    try {
      // Admission/snapshot is synchronous; listeners always start in a microtask.
      await Promise.resolve()
      for (const subscription of snapshot) {
        if (!subscription.active) continue
        let completed!: () => void
        const running = new Promise<void>((resolve) => { completed = resolve })
        subscription.owner?.running.add(running)
        count++
        try {
          const invocation = subscription.signal ? Object.freeze({ ...context, signal: subscription.signal }) : context
          await subscription.listener(payload, invocation)
        } catch (error) { errors.push(error) } finally {
          subscription.owner?.running.delete(running)
          completed()
          if (subscription.once) subscription.dispose()
        }
      }
      if (errors.length) throw new EventDispatchError(context.id, context.name, errors)
      return Object.freeze({ eventId: context.id, name: context.name, listenerCount: count })
    } finally {
      dispatch.active = false
      finish()
    }
  }

  private closeOwner(owner: Owner): Promise<void> {
    owner.closing ??= (async () => {
      owner.state = 'closing'
      for (const subscription of [...owner.listeners]) subscription.dispose()
      await Promise.all([...owner.running])
      owner.state = 'closed'
      this.owners.delete(owner)
    })()
    return owner.closing
  }

  private async shutdown(): Promise<void> {
    this.current = 'closing'
    // Context-owned follow-up dispatches may join while accepted listeners run.
    while (this.pending.size) await Promise.all([...this.pending])
    for (const group of this.listeners.values()) for (const subscription of [...group]) subscription.dispose()
    await Promise.all([...this.owners].map((owner) => this.closeOwner(owner)))
    this.current = 'closed'
  }
}
