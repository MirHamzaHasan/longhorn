import { openPostgres } from '../../runtimes/node/dist/postgres.js'
import { createScryptPasswordHasher } from '../../runtimes/node/dist/passwords.js'
import { holdPasswordTransaction } from './password-change-transaction.mjs'
await holdPasswordTransaction({ database: await openPostgres({ connectionString: process.env.LONGHORN_PG_APP_URL, maxConnections: 1 }), passwords: createScryptPasswordHasher(), runtime: 'pg', stateFile: process.argv[2] })
