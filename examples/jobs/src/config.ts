import { z } from 'zod'
import { parseOtlpHeaders } from '@longhorn/observability/otlp'

const otlpEndpoint=z.string().refine(value => { try { const url=new URL(value);return ['http:','https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password && !url.search && !url.hash } catch { return false } },'Expected an HTTP(S) OTLP signal endpoint without credentials/query/hash')
const otlpHeaders=z.string().default('').transform((value,context) => {
  try { return parseOtlpHeaders(value) } catch { context.addIssue({ code: 'custom',message: 'Invalid OTLP headers' });return z.NEVER }
})
const emptyToUndefined=(value: unknown) => value==='' ? undefined : value

export const configSchema = z.object({
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.string().trim().regex(/^\d+$/).default('3002').transform(Number).pipe(z.number().int().min(0).max(65535)),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  DATABASE_PATH: z.string().trim().min(1).default('./data/jobs.sqlite'),
  WORKER_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  SHUTDOWN_GRACE_MS: z.string().trim().regex(/^\d+$/).default('0').transform(Number).pipe(z.number().int().min(0).max(10_000)),
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.preprocess(emptyToUndefined,otlpEndpoint.optional()),
  OTEL_EXPORTER_OTLP_TRACES_HEADERS: otlpHeaders,
  OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: z.preprocess(emptyToUndefined,z.string().regex(/^\d+$/).default('10000').transform(Number).pipe(z.number().int().min(1).max(60000))),
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: z.preprocess(emptyToUndefined,otlpEndpoint.optional()),
  OTEL_EXPORTER_OTLP_METRICS_HEADERS: otlpHeaders,
  OTEL_EXPORTER_OTLP_METRICS_TIMEOUT: z.preprocess(emptyToUndefined,z.string().regex(/^\d+$/).default('10000').transform(Number).pipe(z.number().int().min(1).max(60000))),
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: z.preprocess(emptyToUndefined,otlpEndpoint.optional()),
  OTEL_EXPORTER_OTLP_LOGS_HEADERS: otlpHeaders,
  OTEL_EXPORTER_OTLP_LOGS_TIMEOUT: z.preprocess(emptyToUndefined,z.string().regex(/^\d+$/).default('10000').transform(Number).pipe(z.number().int().min(1).max(60000))),
  OTEL_METRIC_EXPORT_INTERVAL: z.preprocess(emptyToUndefined,z.string().regex(/^\d+$/).default('60000').transform(Number).pipe(z.number().int().min(1).max(3600000))),
  OTEL_SERVICE_INSTANCE_ID: z.preprocess(emptyToUndefined,z.string().min(1).max(256).regex(/^[^\x00-\x1f\x7f]+$/).optional()),
  OTEL_SERVICE_NAME: z.preprocess(emptyToUndefined,z.string().trim().min(1).max(256).regex(/^[^\x00-\x1f\x7f]+$/).default('longhorn-jobs')),
  OTEL_SERVICE_VERSION: z.preprocess(emptyToUndefined,z.string().min(1).max(256).regex(/^[^\x00-\x1f\x7f]+$/).optional()),
}).transform(({ HOST, PORT, LOG_LEVEL, DATABASE_PATH, WORKER_ENABLED, SCHEDULER_ENABLED, SHUTDOWN_GRACE_MS,
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,OTEL_EXPORTER_OTLP_TRACES_HEADERS,OTEL_EXPORTER_OTLP_TRACES_TIMEOUT,OTEL_SERVICE_NAME,OTEL_SERVICE_VERSION,
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,OTEL_EXPORTER_OTLP_METRICS_HEADERS,OTEL_EXPORTER_OTLP_METRICS_TIMEOUT,OTEL_METRIC_EXPORT_INTERVAL,OTEL_SERVICE_INSTANCE_ID,
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,OTEL_EXPORTER_OTLP_LOGS_HEADERS,OTEL_EXPORTER_OTLP_LOGS_TIMEOUT }) => {
  const resourceAttributes = { 'service.instance.id': OTEL_SERVICE_INSTANCE_ID ?? globalThis.crypto.randomUUID() }
  return {
  hostname: HOST, port: PORT, logLevel: LOG_LEVEL, databasePath: DATABASE_PATH, workerEnabled: WORKER_ENABLED,
  schedulerEnabled: SCHEDULER_ENABLED,
  shutdownGraceMs: SHUTDOWN_GRACE_MS,
  ...(OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ? { otlp: { endpoint: OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,headers: OTEL_EXPORTER_OTLP_TRACES_HEADERS,
    timeoutMs: OTEL_EXPORTER_OTLP_TRACES_TIMEOUT,serviceName: OTEL_SERVICE_NAME,resourceAttributes,...(OTEL_SERVICE_VERSION===undefined ? {} : { serviceVersion: OTEL_SERVICE_VERSION }) } } : {}),
  ...(OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ? { metricExportIntervalMs: OTEL_METRIC_EXPORT_INTERVAL,otlpMetrics: {
    endpoint: OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,headers: OTEL_EXPORTER_OTLP_METRICS_HEADERS,timeoutMs: OTEL_EXPORTER_OTLP_METRICS_TIMEOUT,
    serviceName: OTEL_SERVICE_NAME,...(OTEL_SERVICE_VERSION===undefined ? {} : { serviceVersion: OTEL_SERVICE_VERSION }),
    resourceAttributes,
  } } : {}),
  ...(OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ? { otlpLogs: { endpoint: OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,headers: OTEL_EXPORTER_OTLP_LOGS_HEADERS,
    timeoutMs: OTEL_EXPORTER_OTLP_LOGS_TIMEOUT,serviceName: OTEL_SERVICE_NAME,resourceAttributes,...(OTEL_SERVICE_VERSION===undefined ? {} : { serviceVersion: OTEL_SERVICE_VERSION }),
  } } : {}),
  }
})
export type AppConfig = Readonly<z.output<typeof configSchema>>
