import { context } from 'esbuild'
import { startHost, stopHost as releaseHost } from './host.mjs'
import { buildOptions } from './build.config.mjs'

let watcher, host, stopping = false, closing, sequence = Promise.resolve()
const controller = new AbortController()
const report = message => console.log(JSON.stringify({ message }))
async function stopHost() {
  const owned = host; host = undefined
  await releaseHost(owned)
}
function shutdown(code = 0) {
  stopping = true; controller.abort()
  if (code) process.exitCode = code
  return closing ??= (async () => {
    try { await watcher?.dispose(); await sequence; await stopHost(); report('Development stopped') }
    catch (error) { process.exitCode = 1; report('Development cleanup failed'); console.log('CLEANUPERROR ' + String(error)) }
  })()
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdown() })
function reload() {
  sequence = sequence.then(async () => {
    if (stopping) return
    await stopHost()
    if (stopping) return
    const owned = await startHost(controller.signal)
    void owned.ended.then(result => {
      if (!owned.intentional && !stopping) { report('Deno SQLite development host exited'); void shutdown(Number.isInteger(result.code) && result.code > 0 && result.code <= 255 ? result.code : 1) }
    })
    host = owned
  }).catch(() => { if (!stopping) { report('Deno SQLite development reload failed'); void shutdown(1) } })
  return sequence
}
try {
  watcher = await context({ ...buildOptions, plugins: [{ name: 'deno-sqlite-owned-reload', setup(builder) {
    builder.onEnd(result => {
      if (stopping) return
      if (result.errors.length) { report('Deno SQLite development build failed'); return }
      return reload()
    })
  } }] })
  if (stopping) { await watcher.dispose(); await closing }
  else { await watcher.watch(); report('Deno SQLite development watching') }
} catch { await shutdown(1) }
