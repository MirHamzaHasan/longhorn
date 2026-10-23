import { spawn } from 'node:child_process'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startOtelCollector } from './otel-collector.mjs'

console.log('Starting a temporary trace collector and reports API. Ctrl+C drains both and removes demo data.')
const controller=new AbortController()
let directory,collector,host,ended,closing,requested=false
const starting=(async () => { directory=await mkdtemp(join(tmpdir(),'longhorn-tracing-demo-'));return startOtelCollector({ signal: controller.signal,onSpans: spans => {
  if (spans.length) console.log(JSON.stringify({ message: 'Collector received traces',count: spans.length,names: spans.slice(0,8).map(item => item.span.name) }))
} }) })()
function shutdown() {
  requested=true;controller.abort()
  return closing ??= (async () => {
    try {
      try { collector=await starting } catch { /* Startup owns its own rollback. */ }
      if (host && host.exitCode===null && host.signalCode===null) {
        host.kill('SIGTERM');const timer=setTimeout(() => host.kill('SIGKILL'),10000)
        try { await ended } finally { clearTimeout(timer) }
      }
    } finally { try { await collector?.stop() } finally { if (directory) await rm(directory,{ recursive: true,force: true }) } }
  })()
}
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => { void shutdown().catch(() => { process.exitCode=1 }) })
try {
  collector=await starting
  if (!requested) {
    host=spawn(process.execPath,[fileURLToPath(new URL('../examples/jobs/dist/index.js',import.meta.url))],{
      detached: true,stdio: 'inherit',env: { ...process.env,HOST: '127.0.0.1',PORT: process.env.PORT ?? '3004',DATABASE_PATH: join(directory,'jobs.sqlite'),
        LOG_LEVEL: 'info',WORKER_ENABLED: 'true',SCHEDULER_ENABLED: 'true',SHUTDOWN_GRACE_MS: '0',OTEL_SERVICE_NAME: 'longhorn-tracing-demo',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: collector.endpoint,OTEL_EXPORTER_OTLP_TRACES_HEADERS: '',OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: '2000' },
    })
    host.on('error',() => { process.exitCode=1 });ended=new Promise(resolve => host.once('close',resolve));await ended
    if (!requested && host.exitCode!==0) process.exitCode=1
  }
} catch { if (!requested) { console.error('Trace demo failed. Check native collector support and build output.');process.exitCode=1 } }
finally { await shutdown() }
