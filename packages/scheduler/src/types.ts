import type { PreparedJob } from '@longhorn/queue'

export type ScheduleTiming =
  | { readonly kind: 'once'; readonly at: number }
  | { readonly kind: 'interval'; readonly intervalMs: number; readonly startAt: number | null }
  | { readonly kind: 'cron'; readonly expression: string; readonly startAt: number | null }
export type MissedPolicy = 'latest' | 'catch-up'
export type ScheduleState = 'active' | 'completed' | 'cancelled'
export type ScheduleDefinition = PreparedJob & {
  readonly id: string; readonly timing: ScheduleTiming; readonly missed: MissedPolicy
}
export type NewSchedule = ScheduleDefinition & { readonly firstAt: number; readonly now: number }
export type ScheduleInfo = {
  readonly id: string; readonly queue: string; readonly timing: ScheduleTiming; readonly missed: MissedPolicy
  readonly state: ScheduleState; readonly firstAt: number; readonly nextAt: number | null
  readonly createdAt: number; readonly updatedAt: number; readonly dispatchCount: number
  readonly lastScheduledAt: number | null; readonly lastJobId: string | null
}
export type StoredSchedule = ScheduleInfo & { readonly payload: string; readonly maxAttempts: number }
export type DispatchedOccurrence = { readonly scheduleId: string; readonly scheduledAt: number; readonly jobId: string }
export type TickResult = { readonly dispatched: readonly DispatchedOccurrence[]; readonly more: boolean }
export interface SchedulerStore {
  /** Atomically create or return the existing definition without changing its cursor/state. */
  create(input: NewSchedule): Promise<StoredSchedule>
  get(id: string): Promise<StoredSchedule | undefined>
  cancel(id: string, now: number): Promise<boolean>
  /** Atomically enqueue each occurrence and advance its cursor in the same backing store. */
  dispatch(input: { readonly now: number; readonly limit: number }): Promise<TickResult>
}
export function scheduleInfo(schedule: StoredSchedule): ScheduleInfo {
  const { payload: _payload, maxAttempts: _attempts, ...info } = schedule
  return { ...info, timing: { ...info.timing } }
}
