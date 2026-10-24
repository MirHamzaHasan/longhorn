import { expect, it } from 'vitest'
import { loadConfig } from '@longhorn/config'
import { maintainedLimitsConfig } from './config.js'
const token = 'a'.repeat(32)
it('keeps cleanup opt-in and validates disabled settings before acquisition', async () => {
  expect((await loadConfig(maintainedLimitsConfig, { API_TOKEN: token })).cleanup).toBeUndefined()
  expect((await loadConfig(maintainedLimitsConfig, { API_TOKEN: token, LIMIT_CLEANUP_ENABLED: 'true' })).cleanup).toEqual({ limit: 100, intervalMs: 60000 })
  for (const bad of [{ LIMIT_CLEANUP_LIMIT: '0' }, { LIMIT_CLEANUP_LIMIT: '10001' }, { LIMIT_CLEANUP_INTERVAL_MS: '999' }, { LIMIT_CLEANUP_INTERVAL_MS: '86400001' }, { LIMIT_CLEANUP_ENABLED: 'yes' }]) await expect(loadConfig(maintainedLimitsConfig, { API_TOKEN: token, ...bad })).rejects.toThrow('Invalid configuration')
})
