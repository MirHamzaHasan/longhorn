import { context } from 'esbuild'
import { startHost, stopHost as releaseHost } from './host.mjs'
import { buildOptions } from './build.config.mjs'

let watcher, host, stopping = false, closing, sequence = Promise.resolve()
const controller = new AbortController()
const report = (message, fields) => console.log(JSON.stringify({ message, ...(fields ? { fields } : {}) }))
async function stopHost() {
  const owned = host; host = undefined
  await releaseHost(owned)
}
function shutdown(code = 0) {
  stopping = true; controller.abort()
  if (code) process.exitCode = code
  return closing ??= (async () => {
    const failures = []
    try { await watcher?.dispose() } catch { failures.push('watcher') }
    try { await sequence } catch { failures.push('reload') }
    try { await stopHost() } catch { failures.push('native host') }
    if (failures.length) { process.exitCode = 1; report('Development cleanup failed', { stages: failures }) }
    else report('Development stopped')
  })()
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdown() })
function reload() {
  sequence = sequence.then(async () => {
    if (stopping) return
    await stopHost()
    if (stopping) return
    const owned = await startHost({ signal: controller.signal })
    void owned.ended.then(result => {
      if (!owned.intentional && !stopping) {
        report('Auth development host exited')
        void shutdown(Number.isInteger(result.code) && result.code > 0 && result.code <= 255 ? result.code : 1)
      }
    })
    host = owned
  }).catch(() => { if (!stopping) { report('Auth development reload failed'); void shutdown(1) } })
  return sequence
}
try {
  watcher = await context({ ...buildOptions, plugins: [{ name: 'auth-owned-reload', setup(builder) {
    builder.onEnd(result => {
      if (stopping) return
      if (result.errors.length) { report('Auth development build failed'); return }
      return reload()
    })
  } }] })
  if (stopping) { await watcher.dispose(); await closing }
  else { await watcher.watch(); report('Auth development watching') }
} catch { await shutdown(1) }
