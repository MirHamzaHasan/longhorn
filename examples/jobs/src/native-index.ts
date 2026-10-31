import { loadConfig } from '@longhornjs/config'
import { createLogger } from '@longhornjs/logger'
import { nodeRuntime } from '@longhornjs/node'
import { readEnv } from '@longhornjs/node/config'
import { openSqlite } from '@longhornjs/node/sqlite'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { createJobsApp } from './app.js'
import { configSchema } from './config.js'
import { JobsDiagnostics } from './diagnostics.js'
import { createJobsLogging } from './logging.js'
import { openOwnedNativeReports } from './owned-native-reports.js'

const bootstrap = createLogger({ bindings: { app: 'owned-native-jobs' } })
const ownerSchema = z.object({
  REPORTS_NATIVE_BINARY: z.string().min(1).refine(isAbsolute, 'Expected an absolute executable path'),
  REPORTS_PROCESS_STARTUP_TIMEOUT_MS: z.string().regex(/^\d+$/).default('5000').transform(Number).pipe(z.number().int().min(1).max(60000)),
  REPORTS_PROCESS_SHUTDOWN_TIMEOUT_MS: z.string().regex(/^\d+$/).default('10000').transform(Number).pipe(z.number().int().min(1).max(60000)),
  REPORTS_NATIVE_TIMEOUT_MS: z.string().regex(/^\d+$/).default('2000').transform(Number).pipe(z.number().int().min(1).max(60000)),
})
try {
  const environment = await readEnv({ files: [new URL('../.env', import.meta.url), new URL('../.env.local', import.meta.url)], ignoreMissing: true })
  const config = await loadConfig(configSchema, environment), owner = await loadConfig(ownerSchema, environment)
  if (config.nativeReports) throw new Error('Owned native mode requires an executable instead of an external service URL')
  const logging = createJobsLogging(config), logger = logging.logger, controller = new AbortController()
  const filename = config.databasePath === ':memory:' ? ':memory:' : resolve(fileURLToPath(new URL('..', import.meta.url)), config.databasePath)
  const app = createJobsApp(config, { logger, ...(logging.processor ? { logs: logging.processor } : {}), openDatabase: () => openSqlite({ filename }),
    openReportComputer: async () => {
      const resource = await openOwnedNativeReports({ executable: owner.REPORTS_NATIVE_BINARY, signal: controller.signal,
        startupTimeoutMs: owner.REPORTS_PROCESS_STARTUP_TIMEOUT_MS, shutdownTimeoutMs: owner.REPORTS_PROCESS_SHUTDOWN_TIMEOUT_MS,
        timeoutMs: owner.REPORTS_NATIVE_TIMEOUT_MS })
      const notify = (action: string) => { if (process.connected) process.send?.({ action, pid: resource.pid }, () => {}) }
      notify('opened'); void resource.exited.then(() => notify('closed'))
      logger.info('Owned native reports ready', { pid: resource.pid, url: resource.baseUrl })
      return resource
    },
  }).onStop(() => { logger.info('Application stopped') })
  let stopping = false, closing: Promise<void> | undefined
  const shutdown = () => {
    if (closing) return closing
    stopping = true; controller.abort()
    const running = app.state === 'running'
    if (running) app.container.resolve(JobsDiagnostics).beginDrain()
    return closing = (async () => {
      logger.info('Application draining')
      if (running && config.shutdownGraceMs) await new Promise(resolve => setTimeout(resolve, config.shutdownGraceMs))
      try { await app.close() } catch (error) { logger.error('Owned native application shutdown failed', { error }); process.exitCode = 1 }
    })()
  }
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
  try {
    const server = await app.listen(nodeRuntime, { hostname: config.hostname, port: config.port })
    logger.info('HTTP server listening', { url: server.url })
  } catch (error) {
    if (!stopping) { logger.error('Owned native application startup failed', { error }); process.exitCode = 1 }
    await shutdown()
  }
} catch (error) { bootstrap.error('Owned native host configuration failed', { error }); process.exitCode = 1 }
