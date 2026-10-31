import{batchRateLimitMigrations}from'@longhornjs/ratelimit/batch-sqlite'
import type { Migration } from '@longhornjs/database'
import{batchIdempotencyMigrations}from'@longhornjs/idempotency/batch-sqlite'
export const migrations:readonly Migration[]=[
  {id:'d1-tasks/001',statements:[`CREATE TABLE d1_tasks(
    position INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
    completed INTEGER NOT NULL CHECK(completed IN(0,1)),revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,mutation TEXT NOT NULL
  )`]},
  {id:'d1-tasks/002',statements:[`CREATE TABLE d1_task_activity(
    position INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 2147483648),
    kind TEXT NOT NULL CHECK(kind IN('created','updated','deleted')),at TEXT NOT NULL,mutation TEXT NOT NULL UNIQUE,UNIQUE(task_id,revision)
  )`,'CREATE INDEX d1_task_activity_task_position ON d1_task_activity(task_id,position)']},
  ...batchIdempotencyMigrations,
  ...batchRateLimitMigrations,
]
