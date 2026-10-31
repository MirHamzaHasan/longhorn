import type { Migration } from '@longhornjs/database'
import { postgresAuthMigrations } from '@longhornjs/auth/postgres'
import { postgresQueueMigrations } from '@longhornjs/queue/postgres'
import { postgresSchedulerMigrations } from '@longhornjs/scheduler/postgres'
import { taskMigrations } from './tasks.js'
import { taskReportMigrations } from './reports.js'
import { privateNoteMigrations } from './private-notes.js'
import { postgresIdempotencyMigrations } from '@longhornjs/idempotency/postgres'

/** Preserve every deployed prefix; append new feature resources to this one history. */
export const postgresExampleMigrations: readonly Migration[]=[
  ...taskMigrations,...postgresQueueMigrations,...postgresSchedulerMigrations,...taskReportMigrations,
  ...postgresAuthMigrations,...privateNoteMigrations,...postgresIdempotencyMigrations,
]
