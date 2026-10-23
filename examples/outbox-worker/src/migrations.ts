import type { Migration } from '@longhorn/database'
import { queueMigrations } from '@longhorn/queue/sqlite'
import { schedulerMigrations } from '@longhorn/scheduler/sqlite'
import { alarmClockMigrations } from '@longhorn/workers/sqlite-alarms'
import { idempotencyMigrations } from '@longhorn/idempotency/sqlite'
import { outboxMigrations, outboxRecoveryMigrations, outboxAuditMigrations } from '@longhorn/outbox/sqlite'

/** One owner history. New recovery resources follow the already deployed command prefix. */
export const commandMigrations: readonly Migration[] = [
  ...queueMigrations, ...schedulerMigrations, ...alarmClockMigrations, ...idempotencyMigrations, ...outboxMigrations,
  { id: 'outbox_example/001_commands', statements: ['CREATE TABLE commands(id TEXT PRIMARY KEY,numbers TEXT NOT NULL) STRICT'] },
  ...outboxRecoveryMigrations,
  ...outboxAuditMigrations,
]
