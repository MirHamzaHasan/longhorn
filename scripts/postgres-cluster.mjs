import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { openPostgres } from '../runtimes/node/dist/postgres.js'

async function binaries() {
  if (process.env.LONGHORN_PG_BIN) return { initdb: join(process.env.LONGHORN_PG_BIN, 'initdb'), postgres: join(process.env.LONGHORN_PG_BIN, 'postgres') }
  const require = createRequire(import.meta.url), native = createRequire(require.resolve('embedded-postgres'))
  return import(native.resolve(`@embedded-postgres/${process.platform}-${process.arch}`))
}
function launch(binary, args) {
  const child = spawn(binary, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk }); child.stderr.on('data', (chunk) => { output += chunk })
  child.on('error', (error) => { output += String(error) })
  const ended = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })))
  return { child, ended, output: () => output }
}
async function port() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address(); const selected = address.port
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return selected
}
/** Owns a brand-new native cluster only. Never starts/stops a user's database service. */
export async function startPostgresCluster() {
  const native = await binaries(), directory = await mkdtemp(join(tmpdir(), 'longhorn-postgres-'))
  const password = randomBytes(24).toString('hex'), passwordFile = join(directory, 'password')
  await writeFile(passwordFile, `${password}\n`, { mode: 0o600 })
  let server, closing
  async function stop() {
    closing ??= (async () => {
      try {
        if (server && server.child.exitCode === null && server.child.signalCode === null) {
          server.child.kill('SIGINT')
          const timeout = setTimeout(() => { try { process.kill(-server.child.pid, 'SIGKILL') } catch {} }, 10000)
          try { await server.ended } finally { clearTimeout(timeout) }
        }
      } finally { await rm(directory, { recursive: true, force: true }) }
    })()
    return closing
  }
  try {
    const initialized = launch(native.initdb, ['-D', join(directory, 'data'), '--username=longhorn_admin', '--encoding=UTF8', '--no-locale', '--auth-host=scram-sha-256', '--auth-local=trust', `--pwfile=${passwordFile}`])
    const initTimeout = setTimeout(() => initialized.child.kill('SIGKILL'), 45000)
    try { const ended = await initialized.ended; if (ended.code !== 0) throw new Error(`Native initdb failed (${ended.signal ?? ended.code}): ${initialized.output()}`) } finally { clearTimeout(initTimeout) }
    const selected = await port()
    server = launch(native.postgres, ['-D', join(directory, 'data'), '-h', '127.0.0.1', '-p', String(selected), '-k', '', '-c', 'max_connections=30'])
    const connectionString = `postgres://longhorn_admin:${password}@127.0.0.1:${selected}/postgres`
    const deadline = Date.now() + 15000
    while (true) {
      if (server.child.exitCode !== null || server.child.signalCode !== null) throw new Error(`Native PostgreSQL exited: ${server.output()}`)
      try {
        const database = await openPostgres({ connectionString, connectionTimeoutMs: 300 })
        const version = String((await database.execute('SHOW server_version')).rows[0].server_version)
        await database.close()
        return { connectionString, version, directory, stop }
      } catch (error) {
        if (Date.now() > deadline) throw new Error(`Native PostgreSQL did not become ready: ${server.output()}`, { cause: error })
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
    }
  } catch (error) { await stop(); throw error }
}
