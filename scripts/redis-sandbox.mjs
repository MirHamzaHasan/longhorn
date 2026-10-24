import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { openRedis } from '../runtimes/node/dist/redis.js'

async function freePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port
}
/** Owns a new authenticated native Redis process/data directory only; never touches an existing service. */
export async function startRedisSandbox() {
  const directory = await mkdtemp(join(tmpdir(), 'longhorn-redis-')), password = randomBytes(32).toString('hex'), port = await freePort()
  const configuration = join(directory, 'redis.conf'), url = 'redis://default:' + password + '@127.0.0.1:' + port + '/0'
  await writeFile(configuration, ['bind 127.0.0.1','protected-mode yes','port ' + port,'daemonize no','logfile ""','dir ' + JSON.stringify(directory),
    'requirepass ' + password,'save ""','appendonly yes','appendfsync always'].join('\n') + '\n', { mode: 0o600 })
  let instance, closed = false, closing
  const open = options => openRedis({ url, allowInsecureLoopback: true, ...options })
  async function stopServer(signal = 'SIGTERM') {
    if (!instance) return
    if (instance.child.exitCode === null && instance.child.signalCode === null) instance.child.kill(signal)
    const timer = setTimeout(() => { if (instance.child.exitCode === null && instance.child.signalCode === null) instance.child.kill('SIGKILL') }, 5000)
    try { return await instance.ended } finally { clearTimeout(timer) }
  }
  async function start() {
    if (closed || instance?.child.exitCode === null && instance?.child.signalCode === null) throw new Error('Redis sandbox cannot start in its current state')
    const child = spawn(process.env.LONGHORN_REDIS_SERVER ?? 'redis-server', [configuration], { stdio: ['ignore','pipe','pipe'] })
    let output = ''; child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
    child.on('error', error => { output += error.message })
    const ended = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
    instance = { child, ended }
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) break
      let connection
      try { connection = await open({ connectTimeoutMs: 300 }); if (await connection.execute(['PING']) === 'PONG') return }
      catch {} finally { await connection?.close() }
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    throw new Error('Owned Redis failed to start: ' + output.replaceAll(password, '[redacted]').slice(-2000))
  }
  function close() { return closing ??= (async () => { closed = true; try { await stopServer() } finally { await rm(directory, { recursive: true, force: true }) } })() }
  try { await start(); return { directory, url, password, port, open, start, stopServer, close } }
  catch (error) { await close(); throw error }
}
