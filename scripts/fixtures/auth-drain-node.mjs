import { nodeRuntime } from '../../runtimes/node/dist/index.js'
import { openSqlite } from '../../runtimes/node/dist/sqlite.js'
import { createScryptPasswordHasher } from '../../runtimes/node/dist/passwords.js'
import { runAuthDrain } from './auth-drain-application.mjs'
await runAuthDrain({ runtime: 'node', adapter: nodeRuntime, passwords: createScryptPasswordHasher(), openDatabase: () => openSqlite({ filename: process.argv[2] }) })
