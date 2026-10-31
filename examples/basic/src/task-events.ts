import { provide, token } from '@longhornjs/container'
import { EventBus, defineEvent } from '@longhornjs/events'
import type { EventContext } from '@longhornjs/events'
import type { Longhorn } from '@longhornjs/core'
import type { Task } from './tasks.js'

export const TaskCreated = defineEvent<{ readonly task: Task }>('task.created')
export const TaskUpdated = defineEvent<{ readonly task: Task }>('task.updated')
export const TaskDeleted = defineEvent<{ readonly taskId: string }>('task.deleted')
export const TaskEvents = token<EventBus>('task events')
export const TaskActivity = token<TaskActivityTracker>('task activity')

type Change = 'created' | 'updated' | 'deleted'
type Latest = { readonly eventId: string; readonly name: string; readonly taskId: string; readonly requestId?: string }
export class TaskActivityTracker {
  private readonly counts = { created: 0, updated: 0, deleted: 0 }
  private latest: Latest | undefined
  record(change: Change, taskId: string, context: EventContext): void {
    this.counts[change]++
    this.latest = Object.freeze({ eventId: context.id, name: context.name, taskId,
      ...(context.correlationId ? { requestId: context.correlationId } : {}),
    })
  }
  snapshot() {
    return Object.freeze({ ...this.counts, ...(this.latest ? { latest: this.latest } : {}) })
  }
}

export function registerTaskEvents(app: Longhorn): void {
  app.container.register(provide(TaskEvents, { factory: () => new EventBus() }))
  app.container.register(provide(TaskActivity, { factory: () => new TaskActivityTracker() }))
}

const configured = new WeakSet<Longhorn>()
/** Register after resources needed by subscribers, so events drain before cleanup. */
export function configureTaskEvents(app: Longhorn): Longhorn {
  if (configured.has(app)) return app
  app.onStart(() => {
    const events = app.container.resolve(TaskEvents)
    const activity = app.container.resolve(TaskActivity)
    const scope = events.scope()
    const observe = (change: Change, taskId: string, context: EventContext) => {
      activity.record(change, taskId, context)
      app.logger.info('Task event observed', {
        event: context.name, eventId: context.id, taskId,
        ...(context.correlationId ? { requestId: context.correlationId } : {}),
      })
    }
    scope.on(TaskCreated, ({ task }, context) => { observe('created', task.id, context) })
    scope.on(TaskUpdated, ({ task }, context) => { observe('updated', task.id, context) })
    scope.on(TaskDeleted, ({ taskId }, context) => { observe('deleted', taskId, context) })
    return () => events.close()
  })
  configured.add(app)
  return app
}
