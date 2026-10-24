import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const directory = fileURLToPath(new URL('.', import.meta.url))
export function startHost(role, signal) {
  signal.throwIfAborted()
  const entry = role === 'app' ? 'dist/operator-host.js' : role === 'receiver' ? 'scripts/serve-receiver.mjs' : undefined
  if (!entry) throw new Error('Unknown development role')
  // Isolate the native resource owner from terminal-group interrupts to the watcher.
  const child = spawn(process.execPath, [entry], { cwd: directory, env: process.env, detached: process.platform !== 'win32', stdio: 'inherit' })
  return { child, intentional: false, ended: new Promise(resolve => {
    child.once('error', () => {})
    child.once('close', (code, signal) => resolve({ code, signal }))
  }) }
}
export async function stopHost(owned) {
  if (!owned) return
  owned.intentional = true
  if (owned.child.exitCode === null && owned.child.signalCode === null) owned.child.kill('SIGTERM')
  let forced = false
  const timer = setTimeout(() => {
    if (owned.child.exitCode !== null || owned.child.signalCode !== null) return
    forced = true
    try { if (process.platform === 'win32') owned.child.kill('SIGKILL'); else process.kill(-owned.child.pid, 'SIGKILL') } catch {}
  }, 10_000)
  try {
    const result = await owned.ended
    if (forced || result.code !== 0 || result.signal !== null) throw new Error('Development host did not close successfully')
  } finally { clearTimeout(timer) }
}
