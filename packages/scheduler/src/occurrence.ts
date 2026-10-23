import { CronExpression, MAX_TIMESTAMP } from './cron.js'
import type { DispatchedOccurrence, NewSchedule, StoredSchedule } from './types.js'

export function initialSchedule(input: NewSchedule): StoredSchedule {
  const { now, ...definition } = input
  return { ...definition, timing: { ...definition.timing }, state: 'active', nextAt: input.firstAt,
    createdAt: now, updatedAt: now, dispatchCount: 0, lastScheduledAt: null, lastJobId: null }
}
export function occurrence(schedule: StoredSchedule, now: number): { dispatch: DispatchedOccurrence; next: StoredSchedule } {
  if (schedule.state !== 'active' || schedule.nextAt === null || schedule.nextAt > now) throw new Error('Schedule is not due')
  let scheduledAt = schedule.nextAt
  let nextAt: number | null = null
  const timing = schedule.timing
  if (timing.kind === 'interval') {
    if (schedule.missed === 'latest') scheduledAt += Math.floor((now - scheduledAt) / timing.intervalMs) * timing.intervalMs
    const future = scheduledAt + timing.intervalMs
    nextAt = Number.isSafeInteger(future) && future <= MAX_TIMESTAMP ? future : null
  } else if (timing.kind === 'cron') {
    const cron = new CronExpression(timing.expression)
    if (schedule.missed === 'latest') {
      const latest = cron.previous(now)
      if (latest === undefined || latest < scheduledAt) throw new Error('Invalid cron schedule cursor')
      scheduledAt = latest
    }
    nextAt = cron.next(scheduledAt) ?? null
  }
  if (!Number.isSafeInteger(schedule.dispatchCount + 1)) throw new Error('Schedule dispatch count exhausted')
  const jobId = `scheduled:${schedule.id}:${scheduledAt}`
  return { dispatch: { scheduleId: schedule.id, scheduledAt, jobId }, next: {
    ...schedule, timing: { ...schedule.timing }, state: nextAt === null ? 'completed' : 'active', nextAt,
    updatedAt: now, dispatchCount: schedule.dispatchCount + 1, lastScheduledAt: scheduledAt, lastJobId: jobId,
  } }
}
