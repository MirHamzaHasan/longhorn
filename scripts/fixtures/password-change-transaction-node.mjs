import { openSqlite } from '../../runtimes/node/dist/sqlite.js'
import { createScryptPasswordHasher } from '../../runtimes/node/dist/passwords.js'
import { holdPasswordTransaction } from './password-change-transaction.mjs'
await holdPasswordTransaction({ database: await openSqlite({ filename: process.argv[2] }), passwords: createScryptPasswordHasher(), runtime: 'node', stateFile: process.argv[3] })
