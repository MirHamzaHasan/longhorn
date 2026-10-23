import { expect, it } from 'vitest'
import { openPostgres } from './postgres.js'
it('rejects invalid configuration without opening a network connection or returning credentials', async () => {
  for (const connectionString of ['', 'not-a-url', 'https://example.com/database', 'postgres://localhost/unused', 'postgres://user@localhost', 'postgres://user:secret@example.com/db?sslmode=disable']) {
    const error = await openPostgres({ connectionString }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).not.toContain('secret')
  }
  for (const options of [{ maxConnections: 0 }, { maxPending: 0 }, { connectionTimeoutMs: 0 }, { statementTimeoutMs: -1 }, { applicationName: 'bad\nname' }]) {
    await expect(openPostgres({ connectionString: 'postgres://unit@localhost/unused', ...options })).rejects.toThrow('Invalid PostgreSQL')
  }
})
