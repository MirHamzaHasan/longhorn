import { MemoryQueueStore } from '@longhorn/queue/memory'
import { initialSchedule, occurrence } from './occurrence.js'
import type { NewSchedule, SchedulerStore, StoredSchedule, TickResult } from './types.js'

const copy = (schedule: StoredSchedule): StoredSchedule => ({ ...schedule, timing: { ...schedule.timing } })
/** One exclusively paired queue backend; state is transient in this process/isolate. */
export class MemorySchedulerStore implements SchedulerStore {
  readonly queueStore = new MemoryQueueStore()
  private readonly schedules = new Map<string, StoredSchedule>()
  private tail: Promise<void> = Promise.resolve()
  private ordered<T>(work: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(work)
    this.tail = result.then(() => {}, () => {})
    return result
  }
  create(input: NewSchedule): Promise<StoredSchedule> {
    return this.ordered(() => {
      const existing = this.schedules.get(input.id)
      if (existing) return copy(existing)
      const row = initialSchedule(input); this.schedules.set(input.id, row); return copy(row)
    })
  }
  get(id: string): Promise<StoredSchedule | undefined> {
    return this.ordered(() => { const row = this.schedules.get(id); return row ? copy(row) : undefined })
  }
  cancel(id: string, now: number): Promise<boolean> {
    return this.ordered(() => {
      const row = this.schedules.get(id)
      if (row?.state !== 'active') return false
      this.schedules.set(id, { ...row, state: 'cancelled', nextAt: null, updatedAt: now }); return true
    })
  }
  dispatch(input: { now: number; limit: number }): Promise<TickResult> {
    return this.ordered(async () => {
      const dispatched = []
      const due = () => [...this.schedules.values()].filter((row) => row.state === 'active' && row.nextAt! <= input.now)
        .sort((a, b) => a.nextAt! - b.nextAt! || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
      while (dispatched.length < input.limit) {
        const row = due(); if (!row) break
        const { dispatch, next } = occurrence(row, input.now)
        await this.queueStore.enqueue({ id: dispatch.jobId, queue: row.queue, payload: row.payload,
          maxAttempts: row.maxAttempts, availableAt: input.now, now: input.now })
        this.schedules.set(row.id, next); dispatched.push(dispatch)
      }
      return { dispatched, more: due() !== undefined }
    })
  }
}
