declare const PAYLOAD: unique symbol

/** Identity comes from id, not the human-readable name. Payload types are invariant. */
export type EventType<T> = {
  readonly id: symbol
  readonly name: string
  readonly [PAYLOAD]?: (payload: T) => T
}
export function defineEvent<T>(name: string): EventType<T> {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Event name must not be empty')
  return Object.freeze({ id: Symbol(name.trim()), name: name.trim() })
}

export type DispatchOptions = { readonly correlationId?: string }
export type DispatchResult = { readonly eventId: string; readonly name: string; readonly listenerCount: number }
export type EventContext = {
  readonly id: string
  readonly name: string
  readonly emittedAt: number
  readonly correlationId?: string
  readonly parentId?: string
  readonly signal?: AbortSignal
  /** A follow-up dispatch inherits correlation and may finish during bus shutdown. */
  emit<T>(type: EventType<T>, payload: NoInfer<T>): Promise<DispatchResult>
}
export type EventListener<T> = (payload: T, context: EventContext) => void | Promise<void>
export type SubscribeOptions = { readonly signal?: AbortSignal }
export interface EventScope {
  readonly state: 'open' | 'closing' | 'closed'
  on<T>(type: EventType<T>, listener: EventListener<NoInfer<T>>, options?: SubscribeOptions): () => void
  once<T>(type: EventType<T>, listener: EventListener<NoInfer<T>>, options?: SubscribeOptions): () => void
  /** Unsubscribe first, then await callbacks already executing in this scope. */
  close(): Promise<void>
}
