import type { Migration } from '@longhornjs/database'
import { queueMigrations } from '@longhornjs/queue/sqlite'
import { schedulerMigrations } from '@longhornjs/scheduler/sqlite'
import { alarmClockMigrations } from '@longhornjs/workers/sqlite-alarms'
import { idempotencyMigrations } from '@longhornjs/idempotency/sqlite'
import { outboxMigrations, outboxRecoveryMigrations, outboxAuditMigrations } from '@longhornjs/outbox/sqlite'

/** One owner history. New recovery resources follow the already deployed command prefix. */
export const commandMigrations: readonly Migration[] = [
  ...queueMigrations, ...schedulerMigrations, ...alarmClockMigrations, ...idempotencyMigrations, ...outboxMigrations,
  { id: 'outbox_example/001_commands', statements: ['CREATE TABLE commands(id TEXT PRIMARY KEY,numbers TEXT NOT NULL) STRICT'] },
  ...outboxRecoveryMigrations,
  ...outboxAuditMigrations,
]
