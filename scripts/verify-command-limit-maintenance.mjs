import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomBytes, createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, readFile, writeFile, rename, readdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { nodeRuntime } from '../runtimes/node/dist/index.js'
import { createScryptPasswordHasher } from '../runtimes/node/dist/passwords.js'
import { migratePostgres } from '../packages/database/dist/postgres.js'
import { RateLimiter } from '../packages/ratelimit/dist/index.js'
import { PostgresRateLimitStore } from '../packages/ratelimit/dist/postgres.js'
import { postgresOperationsMigrations } from '../examples/postgres/dist/operations-migrations.js'
import { grantOperatorRuntime } from '../examples/postgres/dist/runtime-grants.js'
import { checkOperatorRuntimeRole } from '../examples/postgres/dist/operator-runtime.js'
import { checkLimitMaintenanceAccess } from '../examples/postgres/dist/limit-maintenance-access.js'
import { grantLimitMaintenance } from '../examples/postgres/dist/limit-maintenance-grants.js'
import { createPostgresApp } from '../examples/postgres/dist/app.js'
import { startPostgresSandbox } from './postgres-sandbox.mjs'
import { freezeCommandDependencies } from './package-command-app.mjs'

const root = fileURLToPath(new URL('..', import.meta.url)), temporary = await mkdtemp(join(tmpdir(), 'longhorn-command-maintenance-'))
const children = [], handles = [], limiters = [], secrets = [], profiles = []
const workspaceOnly = process.argv.includes('--workspace-only'), entry = join(root, 'examples/postgres/dist/maintain-limits.js')
let sandbox, application, writing, release
const sleep = ms => new Promise(done => setTimeout(done, ms))
const safe = value => { for (const secret of secrets) value = value.replaceAll(secret, '[redacted]'); return value }
const waitFor = async test => { const end = Date.now() + 20000; while (Date.now() < end) { const value = await test(); if (value) return value; await sleep(10) }; throw new Error('Command maintenance native condition timed out') }
function launch(binary, args, directory = root, overrides = {}) {
  const env = { ...process.env, DATABASE_URL: undefined, MIGRATION_DATABASE_URL: undefined, MAINTENANCE_DATABASE_URL: undefined, ...overrides }; for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key]
  const child = spawn(binary, args, { cwd: directory, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }), records = []; let output = ''
  for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', line => { output += line + '\n'; try { records.push(JSON.parse(line)) } catch {} })
  child.on('error', () => {})
  const instance = { child, records, output: () => safe(output), rawOutput: () => output, ended: new Promise(done => child.once('close', (code, signal) => done({ code, signal }))) }; children.push(instance); return instance
}
function signal(instance, value) { if (instance.child.exitCode !== null || instance.child.signalCode !== null) return; try { if (process.platform === 'win32') instance.child.kill(value); else process.kill(-instance.child.pid, value) } catch (error) { if (error.code !== 'ESRCH') throw error } }
async function finish(instance, expected = 0, timeout = 120000) { const timer = setTimeout(() => signal(instance, 'SIGKILL'), timeout); try { assert.equal((await instance.ended).code, expected, instance.output()); return instance } finally { clearTimeout(timer) } }
async function run(binary, args, directory = root, overrides = {}, expected = 0) { return finish(launch(binary, args, directory, overrides), expected) }
const connect = async options => { const database = await openPostgres(options); handles.push(database); return database }
const report = instance => { for (const secret of secrets) assert.ok(!instance.rawOutput().includes(secret), 'Maintenance output exposed private input'); assert.ok(!instance.rawOutput().includes('longhorn_bucket_maintenance'), 'Maintenance output exposed a role'); const value = instance.records.findLast(row => row.schemaVersion === 1 && 'ok' in row); assert.ok(value, instance.output()); assert.deepEqual(Object.keys(value).sort(), ['schemaVersion', 'mode', 'ok', 'cancelled', 'runs', 'removed', 'errors', 'observerErrors'].sort()); return value }
try {
  sandbox = await startPostgresSandbox(); secrets.push(sandbox.ownerUrl, sandbox.appUrl, sandbox.connectionString)
  const owner = await connect({ connectionString: sandbox.ownerUrl }), admin = await connect({ connectionString: sandbox.connectionString }), runtime = await connect({ connectionString: sandbox.appUrl })
  const password = randomBytes(24).toString('hex'), role = 'longhorn_bucket_maintenance'; secrets.push(password)
  await admin.execute("CREATE ROLE " + role + " LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '" + password + "'")
  await admin.execute('GRANT CONNECT ON DATABASE longhorn_test TO ' + role)
  const address = new URL(sandbox.ownerUrl); address.username = role; address.password = password; const maintenanceUrl = address.href; secrets.push(maintenanceUrl)
  const database = await connect({ connectionString: maintenanceUrl }), environment = { MAINTENANCE_DATABASE_URL: maintenanceUrl, LIMIT_MAINTENANCE_LIMIT: '2', LIMIT_MAINTENANCE_INTERVAL_MS: '1000', LIMIT_MAINTENANCE_STATEMENT_TIMEOUT_MS: '30000' }
  const command = (mode, extra = {}) => run(process.execPath, [entry, mode], root, { ...environment, ...extra })
  const missing = await run(process.execPath, [entry, 'once'], root, environment, 1); assert.equal(report(missing).runs, 0); assert.equal((await owner.execute("SELECT to_regclass('longhorn_rate_limit.buckets')::text AS name")).rows[0].name, null)
  await migratePostgres(owner, postgresOperationsMigrations, { schema: 'longhorn_pg_example' }); await grantOperatorRuntime(owner, 'longhorn_app')
  await assert.rejects(grantLimitMaintenance(owner, 'longhorn_app')); assert.equal((await owner.execute("SELECT has_table_privilege('longhorn_app','longhorn_rate_limit.buckets','DELETE') AS allowed")).rows[0].allowed, false)
  await run(process.execPath, [join(root, 'examples/postgres/dist/provision-limit-maintenance.js'), role], root, { MIGRATION_DATABASE_URL: sandbox.ownerUrl }); await checkLimitMaintenanceAccess(database); await checkOperatorRuntimeRole(runtime)
  await assert.rejects(checkLimitMaintenanceAccess(owner)); await assert.rejects(checkLimitMaintenanceAccess(runtime))
  const history = (await owner.execute('SELECT position,id,checksum FROM longhorn_pg_example.longhorn_migrations ORDER BY position')).rows
  const rows = async () => (await owner.execute('SELECT * FROM longhorn_rate_limit.buckets ORDER BY scope,subject_hash')).rows
  const make = (scope, expired = false) => { const limiter = new RateLimiter({ scope, limit: 1, windowMs: expired ? 1000 : 86400000, now: () => Date.now() - (expired ? 2000 : 0), store: new PostgresRateLimitStore(runtime) }); limiters.push(limiter); return limiter }
  const live = make('native.live.v1'); await live.consume('private retained principal'); await live.consume('private retained principal'); const liveRows = await rows()
  const beforeCheck = await rows(), checked = report(await command('check')); assert.deepEqual(checked, { schemaVersion: 1, mode: 'check', ok: true, cancelled: false, runs: 0, removed: 0, errors: 0, observerErrors: 0 }); assert.deepEqual(await rows(), beforeCheck)
  for (const [grant, revoke, identity = owner] of [
    ['GRANT UPDATE(expires_at) ON longhorn_rate_limit.buckets TO ' + role, 'REVOKE UPDATE(expires_at) ON longhorn_rate_limit.buckets FROM ' + role],
    ['GRANT CREATE ON SCHEMA public TO ' + role, 'REVOKE CREATE ON SCHEMA public FROM ' + role],
    ['GRANT INSERT(scope) ON longhorn_rate_limit.buckets TO ' + role, 'REVOKE INSERT(scope) ON longhorn_rate_limit.buckets FROM ' + role],
    ['GRANT SELECT(id) ON longhorn_pg_example.operator_commands TO ' + role, 'REVOKE SELECT(id) ON longhorn_pg_example.operator_commands FROM ' + role],
    ['GRANT longhorn_app TO ' + role, 'REVOKE longhorn_app FROM ' + role, admin],
    ['ALTER TABLE longhorn_rate_limit.buckets ENABLE ROW LEVEL SECURITY', 'ALTER TABLE longhorn_rate_limit.buckets DISABLE ROW LEVEL SECURITY'],
    ['ALTER TABLE longhorn_rate_limit.buckets ALTER COLUMN expires_at TYPE numeric', 'ALTER TABLE longhorn_rate_limit.buckets ALTER COLUMN expires_at TYPE bigint'],
  ]) { await identity.execute(grant); try { const rejected = await run(process.execPath, [entry, 'once'], root, environment, 1); assert.equal(report(rejected).runs, 0); assert.equal(report(rejected).removed, 0) } finally { await identity.execute(revoke) } }
  assert.deepEqual(await rows(), liveRows)
  const badConfig = await run(process.execPath, [entry, 'once'], root, { ...environment, MAINTENANCE_DATABASE_URL: 'postgres://private-configuration', LIMIT_MAINTENANCE_LIMIT: '0' }, 1); assert.equal(report(badConfig).runs, 0); assert.ok(!badConfig.output().includes('private-configuration'))
  const invalid = await run(process.execPath, [entry, 'reset'], root, environment, 1); assert.equal(invalid.records.length, 0)
  const stale = make('native.expired.v1', true); for (const subject of ['a', 'b', 'c', 'd']) await stale.consume(subject)
  const concurrent = await Promise.all([command('once'), command('once')]); assert.deepEqual(concurrent.map(value => report(value).removed).sort(), [2, 2]); assert.deepEqual(await rows(), liveRows)
  console.log('Maintenance authority: real complete schema, separate minimal grants, atomic refusal of the HTTP role, owner/runtime/excess column/business/membership/RLS/type rejection and two native one-shot processes pass.')

  const origin = 'http://127.0.0.1:3043', accountPassword = 'native maintenance account password'; secrets.push(accountPassword)
  application = createPostgresApp({ workerEnabled: false, schedulerEnabled: false, openDatabase: () => openPostgres({ connectionString: sandbox.appUrl }), accounts: { origin, secure: false, sessionTtlMs: 28800000, passwords: createScryptPasswordHasher() }, operations: { commandLimits: { limit: 1, windowMs: 1000 } } })
  const url = (await application.listen(nodeRuntime, { hostname: '127.0.0.1', port: 0 })).url
  const post = (value, cookie) => ({ method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(value) })
  assert.equal((await fetch(url + '/account/register', post({ username: 'maintenance.member', password: accountPassword }))).status, 201)
  const login = await fetch(url + '/account/login', post({ username: 'maintenance.member', password: accountPassword })); assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0]; secrets.push(cookie)
  const input = { id: 'preserved-command', numbers: [2, 4, 6] }, first = await fetch(url + '/account/commands', post(input, cookie)); assert.equal(first.status, 201); const original = await first.json()
  assert.equal((await fetch(url + '/account/commands', post(input, cookie))).status, 429)
  const business = async () => ({ commands: (await owner.execute('SELECT * FROM longhorn_pg_example.operator_commands ORDER BY id')).rows, jobs: (await owner.execute('SELECT * FROM longhorn_queue.jobs ORDER BY id')).rows, audit: (await owner.execute('SELECT * FROM longhorn_outbox.recovery_audit ORDER BY id')).rows, replay: (await owner.execute('SELECT * FROM longhorn_idempotency.requests ORDER BY scope,request_key')).rows })
  const effects = await business(); await waitFor(async () => (await owner.execute("SELECT expires_at FROM longhorn_rate_limit.buckets WHERE scope='account.commands.v1'")).rows[0].expires_at <= Date.now())
  assert.equal(report(await command('once')).removed, 1); assert.deepEqual(await business(), effects)
  const replay = await fetch(url + '/account/commands', post(input, cookie)); assert.equal(replay.status, 201); assert.equal(replay.headers.get('idempotency-replayed'), 'true'); assert.deepEqual(await replay.json(), original); assert.deepEqual(await business(), effects); await application.close(); application = undefined

  const blocked = async (mode, interrupt) => {
    await make('blocked.' + mode, true).consume('held'); let held = false, pid
    const gate = new Promise(done => { release = done })
    writing = owner.transaction(async tx => { pid = (await tx.execute('SELECT pg_backend_pid() AS pid')).rows[0].pid; await tx.execute('LOCK TABLE longhorn_rate_limit.buckets IN ACCESS EXCLUSIVE MODE'); held = true; await gate }); await waitFor(() => held)
    const child = launch(process.execPath, [entry, mode], root, environment)
    await waitFor(async () => (await runtime.execute({ sql: "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='longhorn-limit-maintenance' AND $1::integer=ANY(pg_blocking_pids(pid))) AS waiting", args: [pid] })).rows[0].waiting === true)
    signal(child, interrupt); await sleep(25); assert.equal(child.child.exitCode, null); assert.equal(child.child.signalCode, null)
    release(); await writing; writing = undefined; await finish(child, mode === 'watch' ? 0 : interrupt === 'SIGINT' ? 130 : 143)
    const value = report(child); assert.equal(value.cancelled, true); assert.ok(value.removed >= 1); assert.equal(value.ok, mode === 'watch')
  }
  await blocked('once', 'SIGINT'); await blocked('watch', 'SIGTERM')
  const watching = launch(process.execPath, [entry, 'watch'], root, environment); await waitFor(() => watching.records.some(row => row.event === 'started'))
  await owner.execute('REVOKE DELETE ON longhorn_rate_limit.buckets FROM ' + role); await waitFor(() => watching.output().includes('Expired command limit cleanup failed'))
  await owner.execute('GRANT DELETE ON longhorn_rate_limit.buckets TO ' + role); await make('watch.recovered.v1', true).consume('recovered')
  await waitFor(async () => !(await owner.execute("SELECT scope FROM longhorn_rate_limit.buckets WHERE scope='watch.recovered.v1'")).rows.length)
  signal(watching, 'SIGTERM'); await finish(watching, 1); assert.equal(report(watching).ok, false); assert.ok(report(watching).errors >= 1)
  assert.deepEqual((await owner.execute('SELECT position,id,checksum FROM longhorn_pg_example.longhorn_migrations ORDER BY position')).rows, history); await checkOperatorRuntimeRole(runtime)
  console.log('Maintenance execution: actual account quota expiry/replay preserves commands/jobs/outbox/ledger; native blocked once/watch drain through signals, grant-loss recovery and unchanged migration/runtime authority pass.')

  if (!workspaceOnly) {
    await run(process.execPath, [join(root, 'scripts/package-command-app.mjs')]); const archive = join(root, '.artifacts/longhorn-command-app.tgz'), checksum = (await readFile(archive + '.sha256', 'utf8')).split(' ')[0]
    assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), checksum)
    await run('tar', ['-xzf', archive, '-C', temporary]); const archived = join(temporary, 'relocated archived app'); await rename(join(temporary, 'longhorn-command-app'), archived)
    const cliPack = JSON.parse((await run('pnpm', ['pack', '--json', '--pack-destination', temporary], join(root, 'cli'))).output()), installed = join(temporary, 'installed CLI'); await mkdir(installed)
    await writeFile(join(installed, 'package.json'), JSON.stringify({ private: true, packageManager: 'pnpm@12.6.0', dependencies: { '@longhorn/cli': 'file:../' + basename(cliPack.filename) } }))
    await run('pnpm', ['install', '--no-frozen-lockfile', '--reporter=append-only'], installed)
    const cli = join(installed, 'node_modules/@longhorn/cli/dist/bin.js'), generated = join(temporary, 'relocated CLI app')
    await run(process.execPath, [cli, 'create', generated, '--runtime', 'node', '--template', 'command-app', '--name', 'maintained-commands'], installed); await freezeCommandDependencies(generated)
    for (const [name, directory] of [['archive', archived], ['packed-cli', generated]]) {
      const frozen = await readFile(join(directory, 'pnpm-lock.yaml'), 'utf8'); await run('pnpm', ['install', '--frozen-lockfile', '--reporter=append-only'], directory, { CI: 'true' }); assert.equal(await readFile(join(directory, 'pnpm-lock.yaml'), 'utf8'), frozen)
      for (const action of ['typecheck', 'test', 'build']) await run('pnpm', [action], directory, { CI: 'true' })
      for (const path of ['src/maintain-limits.ts', 'src/limit-maintenance.ts', 'src/limit-maintenance-access.ts', 'src/limit-maintenance-grants.ts', 'docs/limit-maintenance.md', '.maintenance.env.example']) assert.ok((await readFile(join(directory, path), 'utf8')).length)
      assert.ok((await readFile(join(directory, '.gitignore'), 'utf8')).includes('.maintenance.env'))
      await run('pnpm', ['provision:limit-maintenance', role], directory, { MIGRATION_DATABASE_URL: sandbox.ownerUrl })
      const before = await rows(), checked = report(await run('pnpm', ['maintain:limits', 'check'], directory, environment)); assert.equal(checked.runs, 0); assert.deepEqual(await rows(), before)
      const expired = make('installed.' + name + '.v1', true); for (const subject of ['a', 'b', 'c']) await expired.consume(subject)
      const first = report(await run('pnpm', ['maintain:limits'], directory, environment)); assert.equal(first.removed, 2); assert.equal(first.runs, 1)
      const second = report(await run('pnpm', ['maintain:limits', 'once'], directory, environment)); assert.equal(second.removed, 1)
      assert.deepEqual((await rows()).filter(row => row.scope === 'native.live.v1'), liveRows)
      const watch = launch(process.execPath, [join(directory, 'dist/maintain-limits.js'), 'watch'], directory, environment); await waitFor(() => watch.records.some(row => row.event === 'started')); signal(watch, 'SIGTERM'); await finish(watch); assert.equal(report(watch).cancelled, true)
      const rejected = await run('pnpm', ['maintain:limits', 'check'], directory, { ...environment, MAINTENANCE_DATABASE_URL: sandbox.appUrl }, 1); assert.equal(report(rejected).runs, 0)
      profiles.push({ profile: name, frozenInstall: true, sourceTestsTypesBuild: true, actualProvisioning: true, readOnlyCheck: true, boundedOnce: [2, 1], livePreserved: true, watchSignal: true, runtimeRejected: true })
    }
    console.log('Maintenance distribution: actual archived and packed-CLI apps independently install frozen, typecheck/test/build, provision, check, prune two bounded batches, preserve live quota and drain watch on signal.')
  }
  await mkdir('.artifacts', { recursive: true }); await writeFile('.artifacts/command-limit-maintenance-proof.json', JSON.stringify({ nativePostgres: true, separateMaintenanceIdentity: true, readOnlyCheck: true, atomicRuntimeRoleRefusal: true, unsupportedRoleAndSchemaRefused: ['owner', 'http-runtime', 'extra-column-update', 'public-schema-create', 'column-insert', 'business-column-read', 'delegated-role', 'rls', 'expiry-type'], concurrentOneShotRemoved: [2, 2], accountCommandAndReplayPreserved: true, blockedOnceAndWatchDrain: true, watchPermissionRecovery: true, historicalErrorsFailExit: true, fixedPrivateReports: true, historyAndRuntimeUnchanged: true, profiles }, null, 2) + '\n')
} finally {
  release?.(); await writing?.catch(() => {}); await application?.close(); for (const limiter of limiters) await limiter.close()
  for (const child of children) if (child.child.exitCode === null && child.child.signalCode === null) { signal(child, 'SIGKILL'); await child.ended }
  for (const database of handles.reverse()) await database.close(); await sandbox?.stop(); await rm(temporary, { recursive: true, force: true })
}
