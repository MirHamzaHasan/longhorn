import { denoRuntime } from '../../runtimes/deno/dist/index.js'
import { openSqlite } from '../../runtimes/deno/dist/sqlite.js'
import { createScryptPasswordHasher } from '../../runtimes/deno/dist/passwords.js'
import { runAuthDrain } from './auth-drain-application.mjs'
await runAuthDrain({ runtime: 'deno', adapter: denoRuntime, passwords: createScryptPasswordHasher(), openDatabase: () => openSqlite({ filename: Deno.args[0] }) })
