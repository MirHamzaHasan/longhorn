import { expect,it } from 'vitest'
import type { Database } from '@longhorn/database'
import { PostgresAuthStore } from './postgres.js'
it('rejects known non-PostgreSQL databases and invalid throttle/maintenance bounds before SQL',async () => {
  const database: Database={ dialect: 'sqlite',execute: async () => { throw new Error('SQL must not run') },transaction: async () => { throw new Error('Transaction must not run') },close: async () => {} }
  expect(() => new PostgresAuthStore(database)).toThrow('PostgreSQL database')
  const store=new PostgresAuthStore({ ...database,dialect: 'postgres' })
  await expect(store.consumeLoginAttempt('key',0,0,1000)).rejects.toThrow('policy')
  await expect(store.consumeLoginAttempt('key',Number.MAX_SAFE_INTEGER,3,1000)).rejects.toThrow('timestamp')
  await expect(store.deleteExpiredLoginAttempts(0,0)).rejects.toThrow('limit')
})
