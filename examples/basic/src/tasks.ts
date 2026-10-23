import { token } from '@longhorn/container'
import { EventDispatchError } from '@longhorn/events'
import type { EventBus, EventType } from '@longhorn/events'
import type { Logger } from '@longhorn/logger'
import { TaskCreated, TaskDeleted, TaskUpdated } from './task-events.js'
import { CacheClosedError, CacheStoreError } from '@longhorn/cache'
import type { Cache } from '@longhorn/cache'

export type Task = {
  readonly id: string
  readonly title: string
  readonly completed: boolean
}
export type TaskSummary = {
  readonly total: number
  readonly completed: number
  readonly pending: number
  readonly generatedAt: string
}

export interface TasksStore {
  list(): Promise<Task[]>
  get(id: string): Promise<Task | undefined>
  create(title: string): Promise<Task>
  update(id: string, completed: boolean): Promise<Task | undefined>
  delete(id: string): Promise<boolean>
}

export const TasksStoreToken = token<TasksStore>('tasks store')

/** Application services depend on a store contract, not a particular database driver. */
export class TasksService {
  private cacheEnabled = true
  constructor(private readonly store: TasksStore, private readonly events: EventBus, private readonly logger: Logger,
    private readonly summaryCache: Cache<TaskSummary>) {}
  list(): Promise<Task[]> { return this.store.list() }
  get(id: string): Promise<Task | undefined> { return this.store.get(id) }
  async summary(): Promise<TaskSummary> {
    if (!this.cacheEnabled) return this.loadSummary()
    try { return await this.summaryCache.getOrLoad('summary', () => this.loadSummary()) }
    catch (error) {
      if (!(error instanceof CacheStoreError || error instanceof CacheClosedError)) throw error
      this.disableCache(error)
      return this.loadSummary()
    }
  }
  async create(title: string, requestId?: string): Promise<Task> {
    const task = await this.store.create(title)
    await this.invalidateSummary()
    await this.publish(TaskCreated, Object.freeze({ task }), requestId)
    return task
  }
  async update(id: string, completed: boolean, requestId?: string): Promise<Task | undefined> {
    const task = await this.store.update(id, completed)
    if (task) { await this.invalidateSummary(); await this.publish(TaskUpdated, Object.freeze({ task }), requestId) }
    return task
  }
  async delete(id: string, requestId?: string): Promise<boolean> {
    const deleted = await this.store.delete(id)
    if (deleted) { await this.invalidateSummary(); await this.publish(TaskDeleted, Object.freeze({ taskId: id }), requestId) }
    return deleted
  }
  private async loadSummary(): Promise<TaskSummary> {
    const tasks = await this.store.list()
    const completed = tasks.filter((task) => task.completed).length
    this.logger.info('Task summary computed', { total: tasks.length, completed })
    return Object.freeze({ total: tasks.length, completed, pending: tasks.length - completed, generatedAt: new Date().toISOString() })
  }
  private async invalidateSummary(): Promise<void> {
    if (!this.cacheEnabled) return
    try { await this.summaryCache.delete('summary') }
    catch (error) {
      // A committed write stays successful; subsequent summaries use source data
      // instead of risking a retained value after provider invalidation failed.
      this.disableCache(error)
    }
  }
  private disableCache(error: unknown): void {
    this.cacheEnabled = false
    this.logger.warn('Task summary cache bypassed', { operation: error instanceof CacheStoreError ? error.operation : 'unavailable' })
  }
  private async publish<T>(type: EventType<T>, payload: NoInfer<T>, requestId?: string): Promise<void> {
    // The store has committed. Observer failures must not turn this result into a
    // misleading failed write that clients might retry and duplicate.
    try { await this.events.emit(type, payload, requestId ? { correlationId: requestId } : {}) }
    catch (error) {
      // A listener can throw arbitrary payloads. Keep the example's failure log
      // to delivery metadata rather than serializing titles or thrown values.
      this.logger.error('Task event delivery failed', {
        event: type.name, failureCount: error instanceof EventDispatchError ? error.errors.length : 1,
        ...(error instanceof EventDispatchError ? { eventId: error.eventId } : {}),
        ...(requestId ? { requestId } : {}),
      })
    }
  }
}
