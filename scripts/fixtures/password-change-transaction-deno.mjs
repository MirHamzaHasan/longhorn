import { openSqlite } from '../../runtimes/deno/dist/sqlite.js'
import { createScryptPasswordHasher } from '../../runtimes/deno/dist/passwords.js'
import { holdPasswordTransaction } from './password-change-transaction.mjs'
await holdPasswordTransaction({ database: await openSqlite({ filename: Deno.args[0] }), passwords: createScryptPasswordHasher(), runtime: 'deno', stateFile: Deno.args[1] })
