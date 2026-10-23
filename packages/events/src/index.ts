export const PACKAGE_NAME = '@longhorn/events'
export { defineEvent } from './event.js'
export type { EventType, EventListener, EventContext, DispatchOptions, DispatchResult, SubscribeOptions, EventScope } from './event.js'
export { EventBus, EventBusClosedError, EventContextExpiredError, EventDispatchError } from './bus.js'
