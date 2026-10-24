import { bunRuntime } from '../../runtimes/bun/dist/index.js'
import { openSqlite } from '../../runtimes/bun/dist/sqlite.js'
import { createScryptPasswordHasher } from '../../runtimes/bun/dist/passwords.js'
import { runAuthDrain } from './auth-drain-application.mjs'
await runAuthDrain({ runtime: 'bun', adapter: bunRuntime, passwords: createScryptPasswordHasher(), openDatabase: () => openSqlite({ filename: process.argv[2] }) })
