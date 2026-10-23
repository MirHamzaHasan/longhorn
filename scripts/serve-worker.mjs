import { Miniflare, Log, LogLevel } from 'miniflare'
import { fileURLToPath } from 'node:url'
import { resolveServeOptions } from '../packages/runtime/dist/index.js'
import { createLogger } from '../packages/logger/dist/index.js'

const port = process.env.PORT ?? '3000'
if (!/^\d+$/.test(port.trim())) throw new Error('PORT must be a decimal integer')
const options = resolveServeOptions({ hostname: process.env.HOST ?? '127.0.0.1', port: Number(port) })
const logger = createLogger({ bindings: { runtime: 'workers-local' } })
const signals = ['SIGINT', 'SIGTERM']
const previousListeners = new Map(signals.map((signal) => [signal, new Set(process.listeners(signal))]))
const worker = new Miniflare({
  modules: true, scriptPath: fileURLToPath(new URL('../examples/portable/dist/worker.js', import.meta.url)),
  compatibilityDate: '2025-07-18', host: options.hostname, port: options.port, cf: false,
  bindings: { GREETING: process.env.GREETING ?? 'Hello from Workers' }, kvNamespaces: ['AUDIT'],
  log: new Log(LogLevel.WARN),
})
// Miniflare 3 installs exit-hook handlers that call process.exit synchronously.
// This standalone host owns graceful shutdown. Replace only handlers added by
// this constructor, while retaining Miniflare's last-resort process exit cleanup.
for (const signal of signals) {
  for (const listener of process.listeners(signal)) {
    if (!previousListeners.get(signal).has(listener)) process.removeListener(signal, listener)
  }
}
try {
  logger.info('HTTP server listening', { url: String(await worker.ready).replace(/\/$/, '') })
} catch (error) {
  try { await worker.dispose() } catch (cleanupError) {
    throw new AggregateError([error, cleanupError], 'Local Worker startup and cleanup failed', { cause: error })
  }
  throw error
}

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  try {
    await worker.dispose()
    logger.info('Application stopped')
  } catch (error) {
    logger.error('Local worker shutdown failed', { error })
    process.exitCode = 1
  }
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
