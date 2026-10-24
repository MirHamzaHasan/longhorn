import { SessionInventory } from '../../packages/auth/dist/session-inventory.js'
import { SqliteAuthStore, authMigrations } from '../../packages/auth/dist/sqlite.js'
import { PostgresAuthStore } from '../../packages/auth/dist/postgres.js'
import { SqliteSessionInventoryStore, sqliteSessionInventoryMigrations } from '../../packages/auth/dist/sqlite-session-inventory.js'
import { PostgresSessionInventoryStore } from '../../packages/auth/dist/postgres-session-inventory.js'
import { migrate } from '../../packages/database/dist/index.js'
const runtime = globalThis.Deno ? 'deno' : globalThis.Bun ? 'bun' : 'node', args = globalThis.Deno ? Deno.args : process.argv.slice(2), [mode, filename, kind = runtime] = args
const pg = kind === 'postgres', raw = (mode === 'before' ? '1' : '3').repeat(64), other = (mode === 'before' ? '2' : '4').repeat(64)
const digest = async token => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, '0')).join('')
const alive = setInterval(() => {}, 1000)
const database = pg ? await (await import('../../runtimes/node/dist/postgres.js')).openPostgres({ connectionString: process.env.INVENTORY_DATABASE_URL }) : await (await import('../../runtimes/' + runtime + '/dist/sqlite.js')).openSqlite({ filename })
try {
  if (!pg) await migrate(database, [...authMigrations, ...sqliteSessionInventoryMigrations])
  const store = pg ? new PostgresAuthStore(database) : new SqliteAuthStore(database), owner = 'inventory-crash-' + mode
  await store.createUser({ id: owner, username: 'inventory.crash.' + mode, roles: [], passwordHash: 'unused-inventory-hash' })
  for (const token of [raw, other]) await store.createSession({ tokenHash: await digest(token), userId: owner, expiresAt: Date.now() + 86400000 })
  const reference = (await database.execute({ sql: 'SELECT session_id FROM ' + (pg ? 'longhorn_auth.sessions' : 'longhorn_auth_sessions') + ' WHERE token_hash=' + (pg ? '$1' : '?'), args: [await digest(other)] })).rows[0].session_id
  const owned = mode === 'before' ? { dialect: database.dialect, execute: database.execute.bind(database), close: database.close.bind(database), transaction: work => database.transaction(async tx => {
    const value = await work(tx); console.log(JSON.stringify({ checkpoint: mode, reference })); await new Promise(() => {}); return value
  }) } : database
  await new SessionInventory(pg ? new PostgresSessionInventoryStore(owned) : new SqliteSessionInventoryStore(owned)).revoke(raw, reference)
  console.log(JSON.stringify({ checkpoint: mode, reference })); await new Promise(() => {})
} finally { clearInterval(alive); await database.close() }
