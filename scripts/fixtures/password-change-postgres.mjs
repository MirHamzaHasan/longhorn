import { openPostgres } from '../../runtimes/node/dist/postgres.js'
import { createScryptPasswordHasher } from '../../runtimes/node/dist/passwords.js'
import { nodeRuntime } from '../../runtimes/node/dist/index.js'
import { createLogger } from '../../packages/logger/dist/index.js'
import { createPostgresApp } from '../../examples/postgres/dist/app.js'

const app = createPostgresApp({ workerEnabled: false, schedulerEnabled: false,
  logger: createLogger({ bindings: { app: 'password-change-pg' } }),
  openDatabase: () => openPostgres({ connectionString: process.env.LONGHORN_PG_APP_URL, maxConnections: 4 }),
  accounts: { origin: 'http://127.0.0.1:3003', secure: false, sessionTtlMs: 28800000, passwords: createScryptPasswordHasher(), passwordChanges: true },
}).onStop(() => console.log(JSON.stringify({ message: 'Application stopped' })))
let closing
const shutdown = () => closing ??= app.close().catch(() => { process.exitCode = 1 })
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
try {
  const server = await app.listen(nodeRuntime, { hostname: '127.0.0.1', port: 0 })
  console.log(JSON.stringify({ message: 'HTTP server listening', url: server.url }))
} catch { await app.close(); console.error('Owned password-change host failed'); process.exitCode = 1 }
