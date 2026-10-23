import { denoRuntime } from '@longhorn/deno'
import { loadConfig } from '@longhorn/config'
import { createLogger } from '@longhorn/logger'
import { createPortableApp } from './app.js'
import { serverConfig } from './config.js'

const config = await loadConfig(serverConfig, {
  HOST: Deno.env.get('HOST'), PORT: Deno.env.get('PORT'), LOG_LEVEL: Deno.env.get('LOG_LEVEL'),
})
const logger = createLogger({ level: config.logLevel, bindings: { runtime: 'deno' } })
const app = createPortableApp('deno', logger).onStop(() => { logger.info('Application stopped') })
const server = await app.listen(denoRuntime, { hostname: config.hostname, port: config.port })
logger.info('HTTP server listening', { url: server.url })

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  try { await app.close() } catch (error) {
    logger.error('Application shutdown failed', { error })
    Deno.exitCode = 1
  } finally {
    Deno.removeSignalListener('SIGINT', shutdown)
    Deno.removeSignalListener('SIGTERM', shutdown)
  }
}
Deno.addSignalListener('SIGINT', shutdown)
Deno.addSignalListener('SIGTERM', shutdown)
