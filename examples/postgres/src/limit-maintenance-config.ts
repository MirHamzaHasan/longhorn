import { z } from 'zod'
import { loadConfig } from '@longhorn/config'
import { readEnv } from '@longhorn/node/config'
import { postgresUrl } from './config.js'
const integer = (fallback: string, min: number, max: number) => z.string().regex(/^\d+$/).default(fallback).transform(Number).pipe(z.number().int().min(min).max(max))
export const limitMaintenanceConfigSchema = z.object({
  MAINTENANCE_DATABASE_URL: postgresUrl,
  LIMIT_MAINTENANCE_LIMIT: integer('100', 1, 10000),
  LIMIT_MAINTENANCE_INTERVAL_MS: integer('60000', 1000, 86400000),
  LIMIT_MAINTENANCE_STATEMENT_TIMEOUT_MS: integer('30000', 1, 60000),
}).transform(input => ({ databaseUrl: input.MAINTENANCE_DATABASE_URL, limit: input.LIMIT_MAINTENANCE_LIMIT,
  intervalMs: input.LIMIT_MAINTENANCE_INTERVAL_MS, statementTimeoutMs: input.LIMIT_MAINTENANCE_STATEMENT_TIMEOUT_MS }))
export type LimitMaintenanceConfig = Readonly<z.output<typeof limitMaintenanceConfigSchema>>
/** Separate files/connection; runtime and provisioning URLs never select this identity. */
export function loadLimitMaintenanceConfiguration() {
  return readEnv({ files: [new URL('../.maintenance.env', import.meta.url), new URL('../.maintenance.env.local', import.meta.url)], ignoreMissing: true })
    .then(environment => loadConfig(limitMaintenanceConfigSchema, environment))
}
