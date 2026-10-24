import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { RateLimiter } from '../packages/ratelimit/dist/index.js'
import { RateLimitCleanup } from '../packages/ratelimit/dist/cleanup.js'
import { SqliteRateLimitStore, rateLimitMigrations } from '../packages/ratelimit/dist/sqlite.js'
import { PostgresRateLimitStore, postgresRateLimitMigrations } from '../packages/ratelimit/dist/postgres.js'
import { migrate } from '../packages/database/dist/index.js'
import { migratePostgres } from '../packages/database/dist/postgres.js'
import { openSqlite } from '../runtimes/node/dist/sqlite.js'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { postgresExampleMigrations } from '../examples/postgres/dist/migrations.js'
import { createMaintainedLimitsApp, BucketCleanup } from '../examples/maintained-limits/dist/app.js'
import { startPostgresSandbox } from './postgres-sandbox.mjs'

const root = fileURLToPath(new URL('..', import.meta.url)), temporary = await mkdtemp(join(tmpdir(), 'longhorn-limit-cleanup-'))
const children = [], databases = [], limiters = [], cleaners = [], runtimes = [], secrets = []
let worker, sandbox, writing, release
const sleep = ms => new Promise(done => setTimeout(done, ms))
const safe = value => { for (const secret of secrets) value = value.replaceAll(secret, '[redacted]'); return value }
const waitFor = async test => { const end = Date.now() + 15000; while (Date.now() < end) { const value = await test(); if (value) return value; await sleep(10) }; throw new Error('Limit cleanup condition timed out') }
function launch(binary, args, environment = {}) {
  const child = spawn(binary, args, { cwd: root, env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] }), records = []; let output = ''
  for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', line => { output += line + '\n'; try { records.push(JSON.parse(line)) } catch {} })
  child.once('error', () => {})
  const instance = { child, records, output: () => safe(output), ended: new Promise(done => child.once('close', (code, signal) => done({ code, signal }))) }; children.push(instance); return instance
}
async function run(binary, args) { const instance = launch(binary, args), timer = setTimeout(() => instance.child.kill('SIGKILL'), 20000); try { assert.equal((await instance.ended).code, 0, instance.output()); const result = instance.records.find(row => row.runtime); assert.ok(result, instance.output()); return result } finally { clearTimeout(timer) } }
async function stop(instance) { instance.child.kill('SIGTERM'); const timer = setTimeout(() => instance.child.kill('SIGKILL'), 10000); try { assert.equal((await instance.ended).code, 0, instance.output()) } finally { clearTimeout(timer) } }
const connect = async (options, sqlite = false) => { const database = await (sqlite ? openSqlite(options) : openPostgres(options)); databases.push(database); return database }
const ownLimiter = options => { const limiter = new RateLimiter(options); limiters.push(limiter); return limiter }
const ownCleanup = (target, options) => { const cleanup = new RateLimitCleanup(target, options); cleaners.push(cleanup); return cleanup }
try {
  const fixture = join(root, 'scripts/fixtures/limit-cleanup-native.mjs')
  runtimes.push(await run(process.execPath, [fixture, join(temporary, 'node.sqlite')]))
  runtimes.push(await run(join(root, 'node_modules/bun-runtime/bin/bun.exe'), [fixture, join(temporary, 'bun.sqlite')]))
  runtimes.push(await run(join(root, 'node_modules/deno-runtime/deno'), ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual', '--allow-read=' + temporary + ',' + join(root, 'runtimes/deno/dist') + ',' + join(root, 'packages/database/dist'), '--allow-write=' + temporary, fixture, join(temporary, 'deno.sqlite')]))
  await build({ entry: { worker: join(root, 'scripts/fixtures/limit-cleanup-worker.mjs') }, outDir: join(temporary, 'bundle'), format: ['esm'], platform: 'browser', target: 'es2022', bundle: true, noExternal: [/.*/], splitting: false, silent: true })
  const scriptPath = join(temporary, 'bundle/worker.js'); worker = new Miniflare({ modules: true, modulesRoot: dirname(scriptPath), scriptPath, compatibilityDate: '2025-07-18', cf: false, host: '127.0.0.1', port: 0, log: new Log(LogLevel.NONE) }); await worker.ready
  const response = await worker.dispatchFetch('http://owned/finite', { signal: AbortSignal.timeout(15000) }); assert.equal(response.status, 200); runtimes.push(await response.json()); await worker.dispose(); worker = undefined
  assert.deepEqual(runtimes.map(row => row.runtime), ['node', 'bun', 'deno', 'workerd']); assert.ok(runtimes.every(row => row.singleFlight && row.closeDrained && row.observerFailure)); assert.ok(runtimes.slice(0, 3).every(row => row.heldNativeDrain && row.livePolicyPreserved))
  console.log('Limit cleanup runtimes: Node/Bun/Deno native SQLite, real locked-write drain, bounded cross-scope removal/live preservation and finite workerd coordination pass.')

  sandbox = await startPostgresSandbox(); secrets.push(sandbox.ownerUrl, sandbox.appUrl, sandbox.connectionString)
  const admin = await connect({ connectionString: sandbox.connectionString }), owner = await connect({ connectionString: sandbox.ownerUrl }), runtime = await connect({ connectionString: sandbox.appUrl })
  await migratePostgres(owner, [...postgresExampleMigrations, ...postgresRateLimitMigrations], { schema: 'longhorn_pg_example' })
  await owner.execute('GRANT USAGE ON SCHEMA longhorn_rate_limit TO longhorn_app'); await owner.execute('GRANT SELECT,INSERT,UPDATE ON longhorn_rate_limit.buckets TO longhorn_app')
  const maintenancePassword = randomBytes(24).toString('hex'); secrets.push(maintenancePassword)
  await admin.execute("CREATE ROLE longhorn_limit_maintenance LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '" + maintenancePassword + "'")
  await admin.execute('GRANT CONNECT ON DATABASE longhorn_test TO longhorn_limit_maintenance')
  await owner.execute('GRANT USAGE ON SCHEMA longhorn_rate_limit TO longhorn_limit_maintenance'); await owner.execute('GRANT SELECT,DELETE ON longhorn_rate_limit.buckets TO longhorn_limit_maintenance')
  const maintenanceUrl = new URL(sandbox.ownerUrl); maintenanceUrl.username = 'longhorn_limit_maintenance'; maintenanceUrl.password = maintenancePassword; secrets.push(String(maintenanceUrl))
  const database = await connect({ connectionString: String(maintenanceUrl) }); let time = 100
  const make = (scope, windowMs, db = runtime) => ownLimiter({ scope, limit: 1, windowMs, now: () => time, store: new PostgresRateLimitStore(db) })
  const short = make('expired.v1', 1000), locked = make('locked.v1', 1000), live = make('live.v1', 10000), maintenance = make('maintenance.v1', 1000, database)
  await short.consume('a'); await short.consume('b'); await locked.consume('held'); await live.consume('retained'); time = 1100
  await assert.rejects(short.prune(1)); await assert.rejects(maintenance.prune(1)) // FOR UPDATE also needs a column UPDATE grant.
  await owner.execute('GRANT UPDATE(claim) ON longhorn_rate_limit.buckets TO longhorn_limit_maintenance')
  await assert.rejects(database.execute("UPDATE longhorn_rate_limit.buckets SET attempts=attempts")); await assert.rejects(database.execute('SELECT * FROM longhorn_pg_example.tasks'))
  let lockedRow = false
  const gate = new Promise(done => { release = done })
  writing = owner.transaction(async tx => { await tx.execute("SELECT scope FROM longhorn_rate_limit.buckets WHERE scope='locked.v1' FOR UPDATE"); lockedRow = true; await gate; await tx.execute("UPDATE longhorn_rate_limit.buckets SET expires_at=2100 WHERE scope='locked.v1'") }); await waitFor(() => lockedRow)
  const cleanup = ownCleanup(maintenance, { limit: 2, intervalMs: 10 }); cleanup.start(); await waitFor(() => cleanup.snapshot().removed === 2 && cleanup.snapshot().runs >= 2)
  assert.equal((await owner.execute('SELECT count(*)::integer AS total FROM longhorn_rate_limit.buckets')).rows[0].total, 2)
  release(); await writing; writing = undefined; await waitFor(() => cleanup.snapshot().runs >= 3); await cleanup.close(); assert.equal(cleanup.snapshot().removed, 2)
  assert.equal((await locked.consume('held')).allowed, false); assert.equal((await live.consume('retained')).allowed, false)
  await owner.execute('REVOKE DELETE ON longhorn_rate_limit.buckets FROM longhorn_limit_maintenance')
  let observed = 0; const recovering = ownCleanup(maintenance, { limit: 1, intervalMs: 10, onError: () => { observed++ } }); recovering.start(); await waitFor(() => observed >= 2)
  await owner.execute('GRANT DELETE ON longhorn_rate_limit.buckets TO longhorn_limit_maintenance'); await owner.execute("UPDATE longhorn_rate_limit.buckets SET expires_at=0 WHERE scope='locked.v1'"); await waitFor(() => recovering.snapshot().removed === 1); await recovering.close()
  let tableHeld = false, pid
  const tableGate = new Promise(done => { release = done })
  writing = owner.transaction(async tx => { pid = (await tx.execute('SELECT pg_backend_pid() AS pid')).rows[0].pid; await tx.execute('LOCK TABLE longhorn_rate_limit.buckets IN ACCESS EXCLUSIVE MODE'); tableHeld = true; await tableGate }); await waitFor(() => tableHeld)
  const draining = ownCleanup(maintenance, { intervalMs: 10 }); draining.start()
  await waitFor(async () => (await runtime.execute({ sql: 'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::integer=ANY(pg_blocking_pids(pid))) AS waiting', args: [pid] })).rows[0].waiting === true)
  let drained = false; const closing = draining.close().then(() => { drained = true }); await sleep(25); assert.equal(drained, false); assert.equal(draining.snapshot().active, true)
  release(); await writing; writing = undefined; await closing; assert.equal((await database.execute('SELECT 1 AS available')).rows[0].available, 1)
  console.log('Limit cleanup PostgreSQL: separate least-privilege maintenance identity, required column-lock grant, skipped renewal, permission recovery and real blocked SQL drain pass; HTTP runtime retains no DELETE.')

  const filename = join(temporary, 'host.sqlite'), token = randomBytes(24).toString('hex'); secrets.push(token)
  const environment = { API_TOKEN: token, DATABASE_PATH: filename, HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'info', RATE_LIMIT_REQUESTS: '2', RATE_LIMIT_WINDOW_MS: '60000', LIMIT_CLEANUP_ENABLED: 'false', LIMIT_CLEANUP_LIMIT: '1', LIMIT_CLEANUP_INTERVAL_MS: '1000' }
  const host = enabled => launch(process.execPath, ['examples/maintained-limits/dist/index.js'], { ...environment, LIMIT_CLEANUP_ENABLED: String(enabled) })
  const listening = instance => waitFor(() => { const record = instance.records.find(row => row.message === 'HTTP server listening'); if (record) return record.fields.url; if (instance.child.exitCode !== null) throw new Error(instance.output()); return false })
  let instance = host(false), url = await listening(instance)
  assert.equal((await fetch(url + '/reports', { method: 'POST', body: '{}' })).status, 401)
  const post = body => ({ method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  let report = await fetch(url + '/reports', post({ numbers: [2, 4, 6] })); assert.equal(report.status, 200); assert.deepEqual((await report.json()).result, { count: 3, sum: 12, min: 2, max: 6 })
  assert.equal((await fetch(url + '/reports', post({ numbers: [] }))).status, 400); assert.equal((await fetch(url + '/reports', post({ numbers: [1] }))).status, 429); await stop(instance)
  const sqlite = await connect({ filename }, true), before = (await sqlite.execute("SELECT * FROM longhorn_rate_limit_buckets WHERE scope='reports.submit.v1'")).rows
  const stale = ownLimiter({ scope: 'stale.v1', limit: 1, windowMs: 1000, now: () => Date.now() - 2000, store: new SqliteRateLimitStore(sqlite) })
  for (const subject of ['a', 'b', 'c']) await stale.consume(subject)
  instance = host(false); url = await listening(instance); await sleep(30); assert.equal(Number((await sqlite.execute("SELECT count(*) AS total FROM longhorn_rate_limit_buckets WHERE scope='stale.v1'")).rows[0].total), 3); await stop(instance)
  instance = host(true); url = await listening(instance); assert.equal(instance.records.find(row => row.message === 'HTTP server listening').fields.cleanupEnabled, true)
  await waitFor(async () => Number((await sqlite.execute("SELECT count(*) AS total FROM longhorn_rate_limit_buckets WHERE scope='stale.v1'")).rows[0].total) === 0)
  assert.deepEqual((await sqlite.execute("SELECT * FROM longhorn_rate_limit_buckets WHERE scope='reports.submit.v1'")).rows, before); assert.equal((await fetch(url + '/reports', post({ numbers: [1] }))).status, 429); await stop(instance)
  const invalidFile = join(temporary, 'invalid', 'reports.sqlite'), bad = launch(process.execPath, ['examples/maintained-limits/dist/index.js'], { ...environment, DATABASE_PATH: invalidFile, LIMIT_CLEANUP_LIMIT: '0' }); assert.equal((await bad.ended).code, 1); await assert.rejects(access(dirname(invalidFile)))
  let rolledBack = false, application
  application = createMaintainedLimitsApp({ apiToken: token, subject: 'startup', limit: 1, windowMs: 1000, cleanup: { intervalMs: 10 }, openDatabase: async () => { const db = await openSqlite({ filename: join(temporary, 'rollback.sqlite') }), close = db.close.bind(db); db.close = async () => { assert.equal(application.container.resolve(BucketCleanup).snapshot().state, 'closed'); rolledBack = true; await close() }; return db } })
  const problem = new Error('startup rollback'); application.onStart(() => { throw problem }); await assert.rejects(application.start(), error => error === problem); await application.close(); assert.equal(rolledBack, true)
  await mkdir('.artifacts', { recursive: true }); await writeFile('.artifacts/limit-cleanup-proof.json', JSON.stringify({ runtimes, postgres: { separateIdentity: true, columnLockGrantRequired: true, runtimeDeleteDenied: true, skippedRenewalPreserved: true, permissionRecovery: true, heldNativeDrain: true }, shippedExample: { actualSum: 12, invalidCounts: true, disabledDoesNotPrune: true, enabledRemovesExpired: 3, liveBucketUnchanged: true, quotaSurvivesRestart: true, invalidConfigBeforeData: true, startupRollback: true } }, null, 2) + '\n')
  console.log('Maintained report executable: real computed result, validation quota, disabled/enabled cleanup, retained live bucket, early private config failure, signal close and startup rollback pass.')
} finally {
  release?.(); await writing?.catch(() => {}); for (const cleanup of cleaners) await cleanup.close().catch(() => {}); await Promise.all(limiters.map(limiter => limiter.close()))
  for (const instance of children) if (instance.child.exitCode === null && instance.child.signalCode === null) { instance.child.kill('SIGKILL'); await instance.ended }
  await worker?.dispose(); for (const database of databases.reverse()) await database.close(); await sandbox?.stop(); await rm(temporary, { recursive: true, force: true })
}
