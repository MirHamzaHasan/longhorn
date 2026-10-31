import { expect,it } from 'vitest'
import type { Database } from '@longhornjs/database'
import { PostgresSchedulerStore } from './postgres.js'
it('rejects a known SQLite database before sending PostgreSQL scheduling SQL',() => {
  const database: Database={ dialect: 'sqlite',execute: async () => { throw new Error('SQL must not run') },transaction: async () => { throw new Error('Transaction must not run') },close: async () => {} }
  expect(() => new PostgresSchedulerStore(database)).toThrow('PostgreSQL database')
})
