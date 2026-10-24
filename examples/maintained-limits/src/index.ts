import { loadConfig } from '@longhorn/config'
import { createLogger } from '@longhorn/logger'
import { readEnv } from '@longhorn/node/config'
import { openSqlite } from '@longhorn/node/sqlite'
import { nodeRuntime } from '@longhorn/node'
import type { Longhorn } from '@longhorn/core'
import { maintainedLimitsConfig } from './config.js'
import { createMaintainedLimitsApp } from './app.js'

let app: Longhorn | undefined, requested = false, closing: Promise<void> | undefined
const bootstrap = createLogger({ bindings: { app: 'maintained-limits' } })
function shutdown() {
  requested = true
  return closing ??= Promise.allSettled([starting, app?.close() ?? Promise.resolve()]).then(([, stopped]) => { if (stopped.status === 'rejected') throw stopped.reason })
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdown().catch(() => { bootstrap.error('Report limits shutdown failed'); process.exitCode = 1 }) })
const starting = (async () => {
  const config = await loadConfig(maintainedLimitsConfig, await readEnv({ files: [new URL('../.env', import.meta.url), new URL('../.env.local', import.meta.url)], ignoreMissing: true }))
  if (requested) return
  const logger = createLogger({ level: config.logLevel, bindings: { app: 'maintained-limits' } })
  app = createMaintainedLimitsApp({ ...config, logger, openDatabase: () => openSqlite({ filename: config.databasePath }),
    ...(config.cleanup ? { cleanup: { ...config.cleanup, onError: () => { logger.warn('Expired request limit cleanup failed') } } } : {}),
  }).onStop(() => { logger.info('Application stopped') })
  const server = await app.listen(nodeRuntime, { hostname: config.hostname, port: config.port })
  if (!requested) logger.info('HTTP server listening', { url: server.url, cleanupEnabled: !!config.cleanup })
})()
try { await starting }
catch { if (!requested) { bootstrap.error('Report limits startup failed; verify configuration and database access'); process.exitCode = 1 }; await shutdown() }
