import { createAuthApp } from '../../examples/auth/dist/app.js'
import { createLogger } from '../../packages/logger/dist/index.js'

export async function runAuthDrain({ runtime, adapter, openDatabase, passwords }) {
  const report = message => console.log(JSON.stringify({ message, runtime }))
  const observed = {
    hash(value) {
      const operation = passwords.hash(value); report('Password work entered')
      return operation.finally(() => report('Password work settled'))
    },
    verify: passwords.verify.bind(passwords),
  }
  const app = createAuthApp({ hostname: '127.0.0.1', port: 0, origin: 'http://127.0.0.1:3001', secure: false, sessionTtlMs: 10000, databasePath: '', logLevel: 'info' }, {
    openDatabase, passwords: observed, logger: createLogger({ bindings: { runtime } }),
  }).onStop(() => report('Application stopped'))
  const server = await app.listen(adapter, { hostname: '127.0.0.1', port: 0 })
  console.log(JSON.stringify({ message: 'HTTP server listening', url: server.url }))
  let closing
  const shutdown = () => closing ??= (async () => { report('Drain requested'); await app.close() })().catch(() => { process.exitCode = 1 })
  if (runtime === 'deno') { Deno.addSignalListener('SIGINT', shutdown); Deno.addSignalListener('SIGTERM', shutdown) }
  else { process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown) }
}
