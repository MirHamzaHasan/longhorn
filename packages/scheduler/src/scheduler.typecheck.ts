import type { Queue } from '@longhorn/queue'
import { Scheduler } from './scheduler.js'
declare const scheduler: Scheduler
declare const queue: Queue<{ numbers: number[] }>
void scheduler.at(queue, { numbers: [1, 2] }, { at: 100 })
// @ts-expect-error Payload follows the queue schema.
void scheduler.every(queue, { numbers: ['wrong'] }, { intervalMs: 100 })
// @ts-expect-error Payload cannot widen the queue type.
void scheduler.cron(queue, { other: true }, { expression: '* * * * *' })
// @ts-expect-error Missed-run policy is explicit.
void scheduler.every(queue, { numbers: [1] }, { intervalMs: 100, missed: 'whatever' })
