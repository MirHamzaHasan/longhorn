import { spawn } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { ConfigError, loadConfig } from '@longhorn/config'

const require = createRequire(import.meta.url)
export const binary = join(dirname(require.resolve('deno-runtime/package.json')), process.platform === 'win32' ? 'deno.exe' : 'deno')
const directory = fileURLToPath(new URL('.', import.meta.url))
const keys = ['APP_NAME', 'HOST', 'PORT', 'LOG_LEVEL', 'DATABASE_PATH', 'CACHE_TTL_MS']
let revision = 0
export async function createPermissions(permissions) {
  const filename = join(directory, '.longhorn-permissions-' + randomUUID() + '.json')
  await writeFile(filename, JSON.stringify({ nodeModulesDir: 'manual', lock: false, permissions: { longhorn: permissions } }), { flag: 'wx', mode: 0o600 })
  return { filename, close: () => rm(filename, { force: true }) }
}
export async function startHost(signal) {
  let environment = {}
  for (const name of ['.env', '.env.local']) {
    try { environment = { ...environment, ...parseEnv(await readFile(join(directory, name), 'utf8')) } }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const selected = Object.fromEntries(keys.flatMap(key => {
    const value = process.env[key] ?? environment[key]; return value === undefined ? [] : [[key, value]]
  }))
  const { configSchema } = await import(new URL('./dist/config.js?launch=' + (++revision), import.meta.url))
  let config
  try { config = await loadConfig(configSchema, selected) }
  catch (error) {
    if (error instanceof ConfigError) console.error(JSON.stringify({ message: 'Deno SQLite configuration failed', fields: { error: error.message } }))
    throw error
  }
  signal?.throwIfAborted()
  const hostname = config.hostname.includes(':') ? '[' + config.hostname + ']' : config.hostname
  const permissions = { net: [hostname], env: keys }
  if (config.databasePath !== ':memory:') {
    const data = dirname(resolve(directory, config.databasePath))
    permissions.read = [data]; permissions.write = [data]
  }
  const policy = await createPermissions(permissions)
  let child
  try {
    signal?.throwIfAborted()
    child = spawn(binary, ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual', '--config=' + policy.filename, '--permission-set=longhorn', 'dist/index.js'], {
      cwd: directory, env: { ...selected, DENO_NO_UPDATE_CHECK: '1' }, stdio: 'inherit',
    })
  } catch (error) { await policy.close(); throw error }
  const owned = { child, intentional: false, ended: new Promise(resolve => {
    child.once('error', () => {}) // close follows failed spawn; no raw executable/env diagnostics.
    child.once('close', async (code, signal) => {
      try { await policy.close() } catch { code = 1 }
      resolve({ code, signal })
    })
  }) }
  return owned
}
export async function stopHost(owned) {
  if (!owned) return
  owned.intentional = true
  if (owned.child.exitCode === null && owned.child.signalCode === null) owned.child.kill('SIGTERM')
  let forced = false
  const timer = setTimeout(() => {
    if (owned.child.exitCode !== null || owned.child.signalCode !== null) return
    forced = true; owned.child.kill('SIGKILL')
  }, 10000)
  try {
    const outcome = await owned.ended
    console.log('HOSTOUTCOME '+JSON.stringify({forced,...outcome}));if (forced || outcome.code !== 0 || outcome.signal !== null) throw new Error('Deno SQLite host did not close successfully')
  } finally { clearTimeout(timer) }
}
