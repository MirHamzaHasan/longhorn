import { spawn } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { ConfigError, loadConfig } from '@longhorn/config'

const directory = fileURLToPath(new URL('.', import.meta.url)), require = createRequire(import.meta.url)
const { longhorn: { runtime } } = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
if (!['node', 'bun', 'deno'].includes(runtime)) throw new Error('Unknown auth runtime')
const binary = runtime === 'node' ? process.execPath : runtime === 'bun'
  ? join(dirname(require.resolve('bun-runtime/package.json')), 'bin/bun.exe')
  : join(dirname(require.resolve('deno-runtime/package.json')), process.platform === 'win32' ? 'deno.exe' : 'deno')
export const keys = Object.freeze(['HOST', 'PORT', 'AUTH_ORIGIN', 'AUTH_COOKIE_SECURE', 'SESSION_TTL_SECONDS', 'DATABASE_PATH', 'LOG_LEVEL'])
let revision = 0
export async function createPermissions(permissions) {
  const filename = join(directory, '.longhorn-permissions-' + randomUUID() + '.json')
  await writeFile(filename, JSON.stringify({ nodeModulesDir: 'manual', lock: false, permissions: { longhorn: permissions } }), { flag: 'wx', mode: 0o600 })
  return { filename, close: () => rm(filename, { force: true }) }
}
export async function startHost({ signal, environment: overrides = {}, stdio = 'inherit' } = {}) {
  let environment = {}
  for (const name of ['.env', '.env.local']) {
    try { environment = { ...environment, ...parseEnv(await readFile(join(directory, name), 'utf8')) } }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const selected = Object.fromEntries(keys.flatMap(key => {
    const value = overrides[key] ?? process.env[key] ?? environment[key]
    return value === undefined ? [] : [[key, value]]
  }))
  const { configSchema } = await import(new URL('./dist/config.js?launch=' + (++revision), import.meta.url))
  let config
  try { config = await loadConfig(configSchema, selected) }
  catch (error) {
    if (error instanceof ConfigError) console.error(JSON.stringify({ message: 'Auth configuration failed', fields: { error: error.message } }))
    throw error
  }
  signal?.throwIfAborted()
  let policy
  if (runtime === 'deno') {
    const hostname = config.hostname.includes(':') ? '[' + config.hostname + ']' : config.hostname
    const permissions = { net: [hostname], env: keys }
    if (config.databasePath !== ':memory:') {
      const data = dirname(resolve(directory, config.databasePath))
      permissions.read = [data]; permissions.write = [data]
    }
    policy = await createPermissions(permissions)
  }
  let child
  try {
    signal?.throwIfAborted()
    const args = runtime === 'deno'
      ? ['run', '--no-prompt', '--no-lock', '--node-modules-dir=manual', '--config=' + policy.filename, '--permission-set=longhorn', 'dist/index.js']
      : ['dist/index.js']
    child = spawn(binary, args, { cwd: directory, env: { ...selected, ...(runtime === 'deno' ? { DENO_NO_UPDATE_CHECK: '1' } : {}) },
      detached: process.platform !== 'win32', stdio })
  } catch (error) { await policy?.close(); throw error }
  return { child, intentional: false, ended: new Promise(resolve => {
    child.once('error', () => {}) // close follows failed spawn; omit native argv/environment diagnostics.
    child.once('close', async (code, signal) => {
      try { await policy?.close() } catch { code = 1 }
      resolve({ code, signal })
    })
  }) }
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
    const result = await owned.ended
    if (forced || result.code !== 0 || result.signal !== null) throw new Error('Auth host did not close successfully: code=' + result.code + ', signal=' + result.signal + ', forced=' + forced)
  } finally { clearTimeout(timer) }
}
