import { openSqlite } from '../../runtimes/bun/dist/sqlite.js'
import { createScryptPasswordHasher } from '../../runtimes/bun/dist/passwords.js'
import { holdPasswordTransaction } from './password-change-transaction.mjs'
await holdPasswordTransaction({ database: await openSqlite({ filename: process.argv[2] }), passwords: createScryptPasswordHasher(), runtime: 'bun', stateFile: process.argv[3] })
