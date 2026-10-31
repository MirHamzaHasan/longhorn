import { bunRuntime } from '@longhornjs/bun'
import { loadConfig } from '@longhornjs/config'
import { createLogger } from '@longhornjs/logger'
import { createPortableApp } from './app.js'
import { serverConfig } from './config.js'

const config = await loadConfig(serverConfig, { HOST: Bun.env.HOST, PORT: Bun.env.PORT, LOG_LEVEL: Bun.env.LOG_LEVEL })
const logger = createLogger({ level: config.logLevel, bindings: { runtime: 'bun' } })
const app = createPortableApp('bun', logger).onStop(() => { logger.info('Application stopped') })
const server = await app.listen(bunRuntime, { hostname: config.hostname, port: config.port })
logger.info('HTTP server listening', { url: server.url })

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  try { await app.close() } catch (error) {
    logger.error('Application shutdown failed', { error })
    process.exitCode = 1
  }
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
