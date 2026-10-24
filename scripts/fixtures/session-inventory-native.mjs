import { inventoryContract } from './session-inventory-contract.mjs'
import { migrate } from '../../packages/database/dist/index.js'
import { SqliteAuthStore, authMigrations } from '../../packages/auth/dist/sqlite.js'
import { SqliteSessionInventoryStore, sqliteSessionInventoryMigrations } from '../../packages/auth/dist/sqlite-session-inventory.js'
const runtime = globalThis.Deno ? 'deno' : globalThis.Bun ? 'bun' : 'node', filename = globalThis.Deno ? Deno.args[0] : process.argv[2]
const { openSqlite } = await import('../../runtimes/' + runtime + '/dist/sqlite.js')
const database = await openSqlite({ filename }), peer = await openSqlite({ filename })
try {
  await migrate(database, authMigrations)
  console.log(JSON.stringify({ runtime, ...await inventoryContract({ database, peer, authStore: new SqliteAuthStore(database), migrations: authMigrations, inventoryMigrations: sqliteSessionInventoryMigrations, migrate: list => migrate(database, list), storeFactory: db => new SqliteSessionInventoryStore(db), dialect: 'sqlite' }) }))
} finally { await peer.close(); await database.close() }
