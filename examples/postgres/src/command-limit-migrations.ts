import { postgresRateLimitMigrations } from '@longhornjs/ratelimit/postgres'
/** Append after the complete deployed operations history; never rewrite its prefix. */
export const postgresCommandLimitMigrations=postgresRateLimitMigrations
