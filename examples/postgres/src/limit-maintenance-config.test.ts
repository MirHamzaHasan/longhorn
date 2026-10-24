import { expect, it } from 'vitest'
import { loadConfig } from '@longhorn/config'
import { limitMaintenanceConfigSchema } from './limit-maintenance-config.js'
import { operatorConfigSchema } from './operator-config.js'
const url = 'postgres://maintenance:private@127.0.0.1/example'
it('requires its own connection and bounded maintenance settings', async () => {
  expect(await loadConfig(limitMaintenanceConfigSchema, { MAINTENANCE_DATABASE_URL: url })).toEqual({ databaseUrl: url, limit: 100, intervalMs: 60000, statementTimeoutMs: 30000 })
  for (const invalid of [{ DATABASE_URL: url }, { MIGRATION_DATABASE_URL: url }, { MAINTENANCE_DATABASE_URL: url, LIMIT_MAINTENANCE_LIMIT: '0' }, { MAINTENANCE_DATABASE_URL: url, LIMIT_MAINTENANCE_LIMIT: '10001' }, { MAINTENANCE_DATABASE_URL: url, LIMIT_MAINTENANCE_INTERVAL_MS: '999' }, { MAINTENANCE_DATABASE_URL: url, LIMIT_MAINTENANCE_STATEMENT_TIMEOUT_MS: '0' }]) await expect(loadConfig(limitMaintenanceConfigSchema, invalid)).rejects.toThrow('Invalid configuration')
})
it('keeps maintenance credentials out of the HTTP configuration', async () => {
  const input = { DATABASE_URL: url, MESSAGE_SERVICE_URL: 'http://127.0.0.1:3012', MESSAGE_SERVICE_TOKEN: 'a'.repeat(32), MESSAGE_ALLOW_INSECURE_LOOPBACK: 'true' }
  await expect(loadConfig(operatorConfigSchema, { ...input, MAINTENANCE_DATABASE_URL: url })).rejects.toThrow('Invalid configuration')
})
