import { startHost, stopHost } from './host.mjs'

let owned, starting, closing, stopping = false
const controller = new AbortController()
const report = message => console.log(JSON.stringify({ message }))
function shutdown() {
  stopping = true; controller.abort()
  return closing ??= (async () => {
    await starting?.catch(() => {})
    try { await stopHost(owned) } catch { process.exitCode = 1; report('Auth host cleanup failed') }
  })()
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown)
try {
  starting = startHost({ signal: controller.signal }); owned = await starting
  const result = await owned.ended
  if (!stopping) process.exitCode = Number.isInteger(result.code) && result.code >= 0 && result.code <= 255 ? result.code : 1
} catch { if (!stopping) { process.exitCode = 1; report('Auth host could not start') } }
finally {
  await closing
  for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, shutdown)
}
