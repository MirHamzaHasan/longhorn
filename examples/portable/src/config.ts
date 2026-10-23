import { z } from 'zod'

export const serverConfig = z.object({
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.string().trim().regex(/^\d+$/).default('3000').transform(Number)
    .pipe(z.number().int().min(0).max(65535)),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
}).transform(({ HOST, PORT, LOG_LEVEL }) => ({ hostname: HOST, port: PORT, logLevel: LOG_LEVEL }))
