import { Miniflare, Log, LogLevel } from 'miniflare'
import { fileURLToPath } from 'node:url'
import { resolveServeOptions } from '../packages/runtime/dist/index.js'

const supplied = process.env.PORT ?? '3006'
if (!/^\d+$/.test(supplied)) throw new Error('PORT must be a decimal integer')
const options = resolveServeOptions({ hostname: process.env.HOST ?? '127.0.0.1', port: Number(supplied) })
const signals = ['SIGINT', 'SIGTERM'], previous = new Map(signals.map(signal => [signal, new Set(process.listeners(signal))]))
const worker = new Miniflare({ modules: true, scriptPath: fileURLToPath(new URL('../examples/durable-worker/dist/index.js', import.meta.url)),
  compatibilityDate: '2025-07-18', host: options.hostname, port: options.port, cf: false, log: new Log(LogLevel.WARN),
  durableObjects: { REPORTS: { className: 'ReportCoordinator', useSQLite: true } },
  durableObjectsPersist: process.env.DURABLE_DATA_PATH ?? fileURLToPath(new URL('../examples/durable-worker/data/objects', import.meta.url)),
})
for (const signal of signals) for (const listener of process.listeners(signal)) if (!previous.get(signal).has(listener)) process.removeListener(signal, listener)
let closing
const shutdown = () => closing ??= worker.dispose().then(() => { console.log(JSON.stringify({ message: 'Application stopped' })) })
for (const signal of signals) process.on(signal, () => { void shutdown().catch(() => { process.exitCode = 1 }) })
try {
  const url = String(await worker.ready).replace(/\/$/, '')
  console.log(JSON.stringify({ message: 'HTTP server listening', fields: { url } }))
  console.log('Run a bounded report tick: '+url+'/cdn-cgi/mf/scheduled?cron=*+*+*+*+*')
} catch (error) { await shutdown(); throw error }
