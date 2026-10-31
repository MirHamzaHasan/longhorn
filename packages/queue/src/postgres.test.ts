import { expect,it } from 'vitest'
import type { Database } from '@longhornjs/database'
import { insertPostgresJob,PostgresQueueStore } from './postgres.js'
it('rejects a known SQLite executor before sending PostgreSQL queue SQL',async () => {
  const database: Database={ dialect: 'sqlite',execute: async () => { throw new Error('SQL must not run') },transaction: async () => { throw new Error('Transaction must not run') },close: async () => {} }
  expect(() => new PostgresQueueStore(database)).toThrow('PostgreSQL database')
  await expect(insertPostgresJob(database,{ queue: 'test',id: 'one',payload: '{}',maxAttempts: 1,now: 1,availableAt: 1 })).rejects.toThrow('PostgreSQL executor')
})
