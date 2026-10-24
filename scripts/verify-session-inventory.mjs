import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { build } from 'tsup'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { inventoryContract } from './fixtures/session-inventory-contract.mjs'
import { SessionInventory } from '../packages/auth/dist/session-inventory.js'
import { PostgresSessionInventoryStore, postgresSessionInventoryMigrations } from '../packages/auth/dist/postgres-session-inventory.js'
import { SqliteSessionInventoryStore } from '../packages/auth/dist/sqlite-session-inventory.js'
import { PostgresAuthStore } from '../packages/auth/dist/postgres.js'
import { migratePostgres } from '../packages/database/dist/postgres.js'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { openSqlite } from '../runtimes/node/dist/sqlite.js'
import { startPostgresSandbox } from './postgres-sandbox.mjs'
import { postgresOperationsMigrations } from '../examples/postgres/dist/operations-migrations.js'
import { grantOperatorRuntime } from '../examples/postgres/dist/runtime-grants.js'
const root = fileURLToPath(new URL('..', import.meta.url)), directory = await mkdtemp(join(tmpdir(), 'longhorn-session-inventory-')), children = [], handles = [], runtimes = []
let sandbox, broker, gateway, held
const sleep = ms => new Promise(done => setTimeout(done, ms))
const waitFor = async test => { const end = Date.now() + 20000; while (Date.now() < end) { const value = await test(); if (value) return value; await sleep(10) }; throw new Error('Inventory native condition timed out') }
function launch(binary, args, environment = {}) {
  const child = spawn(binary, args, { cwd: root, env: { ...process.env, ...environment }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }), records = []; let output = ''
  for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', line => { output += line + '\n'; try { records.push(JSON.parse(line)) } catch {} })
  child.on('error', () => {}); const instance = { child, records, output: () => output.replace(/\b[a-f0-9]{64}\b/g, '[fixture digest]'), ended: new Promise(done => child.once('close', (code, signal) => done({ code, signal }))) }; children.push(instance); return instance
}
function kill(instance) { if (instance.child.exitCode !== null || instance.child.signalCode !== null) return; try { if (process.platform === 'win32') instance.child.kill('SIGKILL'); else process.kill(-instance.child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } }
async function completed(instance) { const timer = setTimeout(() => kill(instance), 60000); try { assert.equal((await instance.ended).code, 0, instance.output()); return instance } finally { clearTimeout(timer) } }
const connect = async options => { const db = await openPostgres(options); handles.push(db); return db }
const binaries = { node: process.execPath, bun: join(root, 'node_modules/bun-runtime/bin/bun.exe'), deno: join(root, 'node_modules/deno-runtime/deno') }
const argumentsFor = (runtime, script, args) => runtime === 'deno' ? ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual', '--allow-read=' + directory + ',' + join(root, 'runtimes/deno/dist') + ',' + join(root, 'packages/database/dist'), '--allow-write=' + directory, script, ...args] : [script, ...args]
try {
  for (const runtime of ['node', 'bun', 'deno']) {
    const filename = join(directory, runtime + '.sqlite'), instance = await completed(launch(binaries[runtime], argumentsFor(runtime, join(root, 'scripts/fixtures/session-inventory-native.mjs'), [filename])))
    const proof = instance.records.find(row => row.runtime === runtime); assert.ok(proof, instance.output()); runtimes.push(proof)
  }
  console.log('Session inventory SQLite: actual Node/Bun/Deno legacy upgrades/defaults/triggers, bounded owner pages, account/session cursor binding, rollback, current/selected revocation and native post-ownership expiry pass.')
  sandbox = await startPostgresSandbox(); const owner = await connect({ connectionString: sandbox.ownerUrl }), database = await connect({ connectionString: sandbox.appUrl }), peer = await connect({ connectionString: sandbox.appUrl })
  const legacy = postgresOperationsMigrations.slice(0, -postgresSessionInventoryMigrations.length)
  assert.equal(legacy.at(-1).id, 'longhorn_rate_limit/001_buckets'); await migratePostgres(owner, legacy, { schema: 'longhorn_pg_example' }); await grantOperatorRuntime(owner, 'longhorn_app')
  const oldHistory = (await owner.execute('SELECT position,id,checksum FROM longhorn_pg_example.longhorn_migrations ORDER BY position')).rows
  const proof = await inventoryContract({ database, peer, authStore: new PostgresAuthStore(database), migrations: legacy, inventoryMigrations: postgresSessionInventoryMigrations, migrate: list => migratePostgres(owner, list, { schema: 'longhorn_pg_example' }), storeFactory: db => new PostgresSessionInventoryStore(db), dialect: 'postgres' }); runtimes.push({ runtime: 'postgres', ...proof })
  assert.deepEqual((await owner.execute('SELECT position,id,checksum FROM longhorn_pg_example.longhorn_migrations ORDER BY position')).rows.slice(0, oldHistory.length), oldHistory)
  for (const runtime of ['node', 'bun', 'deno', 'postgres']) for (const mode of ['before', 'after']) {
    const pg = runtime === 'postgres', filename = join(directory, 'crash-' + runtime + '-' + mode + '.sqlite'), db = pg ? database : await openSqlite({ filename }), script = join(root, 'scripts/fixtures/session-inventory-crash.mjs')
    try {
      const child = launch(pg ? process.execPath : binaries[runtime], argumentsFor(pg ? 'node' : runtime, script, [mode, filename, runtime]), pg ? { INVENTORY_DATABASE_URL: sandbox.appUrl } : {})
      const checkpoint = await waitFor(() => { const point = child.records.find(row => row.checkpoint === mode); if (point) return point; if (child.child.exitCode !== null || child.child.signalCode !== null) throw new Error(child.output()); return false })
      const table = pg ? 'longhorn_auth.sessions' : 'longhorn_auth_sessions', statement = { sql: 'SELECT session_id FROM ' + table + ' WHERE session_id=' + (pg ? '$1' : '?'), args: [checkpoint.reference] }
      assert.equal((await db.execute(statement)).rows.length, mode === 'before' ? 1 : 0)
      kill(child); assert.equal((await child.ended).signal, 'SIGKILL'); assert.equal((await db.execute(statement)).rows.length, mode === 'before' ? 1 : 0)
      const retry = await new SessionInventory(pg ? new PostgresSessionInventoryStore(db) : new SqliteSessionInventoryStore(db)).revoke((mode === 'before' ? '1' : '3').repeat(64), checkpoint.reference)
      assert.equal(retry.revokedSessions, mode === 'before' ? 1 : 0)
    } finally { if (!pg) await db.close() }
  }
  console.log('Session inventory PostgreSQL/crashes: restricted native role, unchanged history prefix, native owner wait and actual SIGKILL before/after deletion commit on all four SQL runtimes pass.')
  gateway = createServer((_request, response) => { held = response }); await new Promise(done => gateway.listen(0, '127.0.0.1', done))
  await build({ entry: { worker: join(root, 'scripts/fixtures/session-inventory-object.mjs') }, outDir: join(directory, 'object'), format: ['esm'], platform: 'browser', target: 'es2022', bundle: true, noExternal: [/.*/], splitting: false, silent: true })
  broker = new Miniflare({ modules: true, modulesRoot: join(directory, 'object'), scriptPath: join(directory, 'object/worker.js'), compatibilityDate: '2025-07-18', cf: false, host: '127.0.0.1', port: 0, log: new Log(LogLevel.NONE), durableObjects: { INVENTORY: { className: 'InventoryFixture', useSQLite: true } }, bindings: { GATE_URL: 'http://127.0.0.1:' + gateway.address().port } }); await broker.ready
  const initial = await broker.dispatchFetch('http://owned/page'); assert.equal(initial.status, 200); assert.equal((await initial.json()).sessions.length, 2)
  const rolledBack = await broker.dispatchFetch('http://owned/rollback'); assert.equal(rolledBack.status, 200); assert.equal((await rolledBack.json()).rollback, true)
  const revoked = await broker.dispatchFetch('http://owned/revoke'); assert.equal(revoked.status, 200); assert.equal((await revoked.json()).revokedSessions, 1)
  const holding = broker.dispatchFetch('http://owned/hold'); await waitFor(() => !!held); let finished = false
  const waiting = broker.dispatchFetch('http://owned/page').then(response => { finished = true; return response }); await sleep(25); assert.equal(finished, false)
  held.end('10001'); await (await holding).arrayBuffer(); const rejected = await waiting; assert.equal(rejected.status, 401); assert.equal((await rejected.json()).expired, true)
  await broker.dispose(); broker = undefined; gateway.closeAllConnections(); await new Promise(done => gateway.close(done)); gateway = undefined
  console.log('Session inventory workerd: actual Object SQLite trigger/default reference, scoped reads, rollback/selected revoke and queued native input-gate expiry pass.')
  await mkdir('.artifacts', { recursive: true }); await writeFile('.artifacts/session-inventory-native-proof.json', JSON.stringify({ runtimes, nativeCrashBeforeAfter: ['node', 'bun', 'deno', 'postgres'], workerdObject: { actualSqlite: true, legacyTrigger: true, rollback: true, selectedRevoke: true, inputGateExpiry: true }, previousProfileChecksumsPreserved: true, originalAuthInterfacesUnchanged: true }, null, 2) + '\n')
} finally { held?.end('10001'); await broker?.dispose(); gateway?.closeAllConnections(); if (gateway) await new Promise(done => gateway.close(done)); for (const child of children) kill(child); await Promise.all(children.map(child => child.ended)); for (const db of handles.reverse()) await db.close(); await sandbox?.stop(); await rm(directory, { recursive: true, force: true }) }
