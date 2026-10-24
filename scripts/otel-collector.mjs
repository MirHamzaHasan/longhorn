import { spawn,execFile } from 'node:child_process'
import { createHash,randomUUID } from 'node:crypto'
import { createReadStream,createWriteStream } from 'node:fs'
import { access,mkdir,mkdtemp,readFile,rename,rm,writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createSocket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
const execute=promisify(execFile),root=fileURLToPath(new URL('..',import.meta.url))
const pin=JSON.parse(await readFile(new URL('../tooling/otelcol.json',import.meta.url),'utf8'))
async function hash(filename) { const digest=createHash('sha256');for await (const chunk of createReadStream(filename)) digest.update(chunk);return digest.digest('hex') }
async function binary(directory,signal) {
  if (process.env.LONGHORN_OTELCOL_BIN) return process.env.LONGHORN_OTELCOL_BIN
  const platform=`${process.platform}-${process.arch}`,asset=pin.platforms[platform]
  if (!asset) throw new Error('No pinned collector archive for this platform; supply LONGHORN_OTELCOL_BIN')
  const cache=join(root,'node_modules/.cache/longhorn',`otelcol-${pin.version}-${platform}`),archive=join(cache,'archive.tar.gz')
  await mkdir(cache,{ recursive: true })
  let exists=true;try { await access(archive) } catch { exists=false }
  if (!exists) {
    const partial=archive+'.'+randomUUID()+'.download'
    try {
      console.log(`Downloading pinned OpenTelemetry Collector ${pin.version} (${platform}).`)
      const response=await fetch(`${pin.releases}/v${pin.version}/${asset.archive}`,{ signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000) })
      if (!response.ok || !response.body) throw new Error('Collector archive download failed')
      await pipeline(Readable.fromWeb(response.body),async function* (source) {
        let size=0
        for await (const chunk of source) { size+=chunk.length;if (size>104_857_600) throw new Error('Collector archive size limit exceeded');yield chunk }
      },createWriteStream(partial))
      if (await hash(partial)!==asset.sha256) throw new Error('Collector archive checksum mismatch')
      await rename(partial,archive)
    } finally { await rm(partial,{ force: true }) }
  }
  if (await hash(archive)!==asset.sha256) throw new Error('Collector archive checksum mismatch; remove the invalid cache archive before retrying')
  // Extract only the known executable from a verified official archive into this owned run.
  await execute('tar',['-xzf',archive,'-C',directory,'otelcol'],{ timeout: 30000,signal })
  return join(directory,'otelcol')
}
async function port() {
  const server=createSocket();await new Promise((resolve,reject) => { server.once('error',reject);server.listen(0,'127.0.0.1',resolve) })
  const selected=server.address().port;await new Promise(resolve => server.close(resolve));return selected
}
/** Owns one temporary collector and loopback JSON sink. Never modifies system services. */
export async function startOtelCollector(options={}) {
  const directory=await mkdtemp(join(tmpdir(),'longhorn-otel-')),records=[],metricRecords=[],logRecords=[]
  let child,ended,sink,closing,output='',received=0,receivedMetricPoints=0,receivedLogRecords=0
  const stop=() => closing ??= (async () => {
    try {
      if (child && child.exitCode===null && child.signalCode===null) {
        child.kill('SIGTERM');const timer=setTimeout(() => child.kill('SIGKILL'),6000)
        try { await ended } finally { clearTimeout(timer) }
      }
    } finally { try { if (sink?.listening) await new Promise(resolve => { sink.close(resolve);sink.closeAllConnections() }) } finally { await rm(directory,{ recursive: true,force: true }) } }
  })()
  try {
    options.signal?.throwIfAborted()
    const executable=await binary(directory,options.signal),version=(await execute(executable,['--version'],{ timeout: 10000,signal: options.signal })).stdout.trim()
    options.signal?.throwIfAborted()
    if (!version.split(/\s+/).includes(pin.version)) throw new Error('Collector binary version does not match the pinned native gate')
    sink=createServer(async (request,response) => {
      try {
        let size=0;const chunks=[]
        for await (const chunk of request) { size+=chunk.length;if (size>4_194_304) throw new Error('Collector sink request too large');chunks.push(chunk) }
        const value=JSON.parse(Buffer.concat(chunks).toString('utf8')),accepted=[]
        for (const resource of value.resourceSpans ?? []) for (const scope of resource.scopeSpans ?? []) for (const span of scope.spans ?? []) {
          const item={ resource: resource.resource,scope: scope.scope,span };accepted.push(item);records.push(item);received++
          if (records.length>512) records.shift()
        }
        options.onSpans?.(accepted)
        const acceptedMetrics=[]
        for (const resource of value.resourceMetrics ?? []) for (const scope of resource.scopeMetrics ?? []) for (const metric of scope.metrics ?? []) {
          const kind=['sum','gauge','histogram'].find(kind=>metric[kind])
          if (!kind) throw new Error('Unexpected native metric kind')
          for (const point of metric[kind].dataPoints ?? []) {
            const item={resource:resource.resource,scope:scope.scope,metric:{...metric,[kind]:{...metric[kind],dataPoints:[point]}}}
            acceptedMetrics.push(item);metricRecords.push(item);receivedMetricPoints++
            if(metricRecords.length>512)metricRecords.shift()
          }
        }
        options.onMetrics?.(acceptedMetrics)
        const acceptedLogs=[]
        for(const resource of value.resourceLogs??[])for(const scope of resource.scopeLogs??[])for(const log of scope.logRecords??[]){
          const item={resource:resource.resource,scope:scope.scope,log};acceptedLogs.push(item);logRecords.push(item);receivedLogRecords++
          if(logRecords.length>512)logRecords.shift()
        }
        options.onLogs?.(acceptedLogs)
        response.writeHead(200,{ 'Content-Type': 'application/json' });response.end('{}')
      } catch { response.writeHead(400,{ 'Content-Type': 'application/json' });response.end('{}') }
    })
    await new Promise((resolve,reject) => { sink.once('error',reject);sink.listen(0,'127.0.0.1',resolve) })
    const receiver=await port(),endpoint=`http://127.0.0.1:${receiver}/v1/traces`,metricsEndpoint=`http://127.0.0.1:${receiver}/v1/metrics`,logsEndpoint=`http://127.0.0.1:${receiver}/v1/logs`,config=join(directory,'collector.json')
    await writeFile(config,JSON.stringify({
      receivers: { otlp: { protocols: { http: { endpoint: `127.0.0.1:${receiver}` } } } },
      exporters: { 'otlphttp/roundtrip': { traces_endpoint: `http://127.0.0.1:${sink.address().port}/v1/traces`,metrics_endpoint: `http://127.0.0.1:${sink.address().port}/v1/metrics`,logs_endpoint: `http://127.0.0.1:${sink.address().port}/v1/logs`,encoding: 'json',compression: 'none',retry_on_failure: { enabled: false },sending_queue: { enabled: false } } },
      service: { telemetry: { logs: { level: 'error' },metrics: { level: 'none',readers: [] } },pipelines: { traces: { receivers: ['otlp'],exporters: ['otlphttp/roundtrip'] },metrics: { receivers: ['otlp'],exporters: ['otlphttp/roundtrip'] },logs: { receivers: ['otlp'],exporters: ['otlphttp/roundtrip'] } } },
    }))
    child=spawn(executable,['--config',config],{ detached: true,stdio: ['ignore','pipe','pipe'] })
    child.on('error',error => { output=(output+error.message).slice(-16384) })
    for (const stream of [child.stdout,child.stderr]) stream.on('data',chunk => { output=(output+chunk).slice(-16384) })
    ended=new Promise(resolve => child.once('close',(code,signal) => resolve({ code,signal })))
    const deadline=Date.now()+15000
    while (true) {
      options.signal?.throwIfAborted()
      if (child.exitCode!==null || child.signalCode!==null) throw new Error('Owned collector exited: '+output)
      try {
        const response=await fetch(endpoint,{ method: 'POST',headers: { 'Content-Type': 'application/json' },body: '{}',signal: AbortSignal.timeout(300) })
        if (response.status===200) { await response.text();break }
      } catch { /* Inspect process/connectivity until startup deadline. */ }
      if (Date.now()>deadline) throw new Error('Owned collector did not become ready: '+output)
      await new Promise(resolve => setTimeout(resolve,20))
    }
    return { endpoint,metricsEndpoint,logsEndpoint,directory,version,snapshot: () => structuredClone(records),metricsSnapshot: () => structuredClone(metricRecords),logsSnapshot: () => structuredClone(logRecords),stats: () => ({ received,retained: records.length,receivedMetricPoints,retainedMetricPoints: metricRecords.length,receivedLogRecords,retainedLogRecords:logRecords.length }),stop }
  } catch (error) { await stop();throw error }
}
