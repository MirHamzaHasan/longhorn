import { expect, it } from 'vitest'
import type { Database } from './index.js'
import { migrate } from './migrations.js'
import { migratePostgres } from './postgres.js'
function unused(dialect: 'postgres' | 'sqlite'): Database {
  return { dialect, execute: async () => { throw new Error('Unexpected SQL') }, transaction: async () => { throw new Error('Unexpected transaction') }, close: async () => {} }
}
it('rejects wrong migration dialects before reaching storage', async () => {
  await expect(migrate(unused('postgres'), [])).rejects.toThrow('migratePostgres')
  await expect(migratePostgres(unused('sqlite'), [])).rejects.toThrow('PostgreSQL database')
})
it('validates schema identifiers and immutable migration identities before opening a transaction', async () => {
  const db = unused('postgres')
  for (const schema of ['unsafe;drop', 'pg_catalog', 'information_schema', 'a'.repeat(64)]) await expect(migratePostgres(db, [], { schema })).rejects.toThrow('schema')
  await expect(migratePostgres(db, [{ id: 'same', statements: [] }, { id: 'same', statements: [] }])).rejects.toThrow('unique')
  await expect(migratePostgres(db, [{ id: 'empty', statements: [''] }])).rejects.toThrow('statements')
})
