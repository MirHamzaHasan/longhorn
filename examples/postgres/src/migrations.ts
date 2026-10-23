import type { Migration } from '@longhorn/database'
import { postgresAuthMigrations } from '@longhorn/auth/postgres'
import { postgresQueueMigrations } from '@longhorn/queue/postgres'
import { postgresSchedulerMigrations } from '@longhorn/scheduler/postgres'
import { taskMigrations } from './tasks.js'
import { taskReportMigrations } from './reports.js'
import { privateNoteMigrations } from './private-notes.js'
import { postgresIdempotencyMigrations } from '@longhorn/idempotency/postgres'

/** Preserve every deployed prefix; append new feature resources to this one history. */
export const postgresExampleMigrations: readonly Migration[]=[
  ...taskMigrations,...postgresQueueMigrations,...postgresSchedulerMigrations,...taskReportMigrations,
  ...postgresAuthMigrations,...privateNoteMigrations,...postgresIdempotencyMigrations,
]
