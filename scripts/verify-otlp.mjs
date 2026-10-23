import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname,join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { Miniflare,Log,LogLevel } from 'miniflare'
import { OtlpHttpSpanExporter } from '../packages/observability/dist/otlp.js'
import { startOtelCollector } from './otel-collector.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(import.meta.url),instances=[]
const temporary=await mkdtemp(join(tmpdir(),'longhorn-otlp-')),authorization='Bearer owned-native-test-only',first=new Set()
let collector,gateway,rejectExports=false
function launch(binary,args,environment={}) {
  const child=spawn(binary,args,{ cwd: root,stdio: ['ignore','pipe','pipe'],env: { ...process.env,...environment } })
  let output='';const records=[]
  createInterface({ input: child.stdout }).on('line',line => { output+=line+'\n';try { records.push(JSON.parse(line)) } catch {} })
  child.stderr.on('data',chunk => { output+=chunk });child.on('error',error => { output+=String(error) })
  const ended=new Promise(resolve => child.once('close',(code,signal) => resolve({ code,signal })))
  const instance={ child,records,ended,output: () => output };instances.push(instance);return instance
}
async function completed(instance) {
  const timer=setTimeout(() => instance.child.kill('SIGKILL'),30000)
  try { const result=await instance.ended;assert.equal(result.code,0,instance.output());return instance.records } finally { clearTimeout(timer) }
}
async function record(instance,predicate) {
  const deadline=Date.now()+10000
  while (Date.now()<deadline) {
    const found=instance.records.find(predicate);if (found) return found
    if (instance.child.exitCode!==null || instance.child.signalCode!==null) break
    await new Promise(resolve => setTimeout(resolve,20))
  }
  throw new Error('Missing native record: '+instance.output())
}
async function dispose(instance) { if (instance.child.exitCode===null && instance.child.signalCode===null) instance.child.kill('SIGKILL');await instance.ended }
const service=item => item.resource.attributes.find(attribute => attribute.key==='service.name')?.value.stringValue
function verifyWire(result) {
  const records=collector.snapshot().filter(item => service(item)==='longhorn-otlp-'+result.runtime)
  assert.equal(records.length,3)
  const parent=records.find(item => item.span.name==='fixture.root').span
  for (const item of records) {
    assert.equal(item.span.traceId,result.traceId);assert.equal(item.span.startTimeUnixNano,'1792760000000500000')
    assert.equal(item.scope.name,'@longhorn/observability');assert.equal(item.scope.version,'0.0.1');assert.equal(item.span.flags&1,1)
    assert.ok(item.resource.attributes.some(attribute => attribute.key==='service.version'&&attribute.value.stringValue==='1.2.3'))
  }
  assert.equal(parent.spanId,result.rootId)
  assert.ok(parent.attributes.some(item => item.key==='integer'&&item.value.intValue==='42'))
  assert.ok(parent.attributes.some(item => item.key==='ratio'&&item.value.doubleValue===1.5))
  assert.ok(parent.attributes.some(item => item.key==='yes'&&item.value.boolValue===true))
  const child=records.find(item => item.span.name==='fixture.child').span,error=records.find(item => item.span.name==='fixture.failure').span
  assert.equal(child.parentSpanId,result.rootId);assert.equal(child.kind,4);assert.equal(error.kind,5);assert.equal(error.status.code,2)
  assert.ok(!JSON.stringify(records).includes('private business error'));assert.equal(result.stats.retries,1)
}
try {
  collector=await startOtelCollector();console.log('Native '+collector.version+': JSON receiver and JSON forwarding pipeline are live on owned loopback ports.')
  gateway=createServer(async (request,response) => {
    try {
      let size=0;const chunks=[]
      for await (const chunk of request) { size+=chunk.length;if (size>2_097_152) throw new Error('Gateway bound');chunks.push(chunk) }
      const payload=Buffer.concat(chunks).toString('utf8')
      if (request.headers.authorization!==authorization || request.headers.cookie) { response.writeHead(401);response.end('private gateway details');return }
      if (request.url==='/timeout') return
      if (request.url==='/partial') { response.writeHead(200,{ 'Content-Type': 'application/json' });response.end('{"partialSuccess":{"rejectedSpans":"1","errorMessage":"private rejection"}}');return }
      if (request.url==='/large') { response.writeHead(200,{ 'Content-Type': 'application/json' });response.end(JSON.stringify({ extra: 'x'.repeat(4096) }));return }
      if (request.url==='/permanent') { response.writeHead(500);response.end('private gateway details');return }
      if (request.url==='/redirect') { response.writeHead(302,{ Location: collector.endpoint });response.end();return }
      const name=JSON.parse(payload).resourceSpans[0].resource.attributes.find(item => item.key==='service.name').value.stringValue
      if (rejectExports || !first.has(name)) { first.add(name);response.writeHead(503,{ 'Retry-After': '0' });response.end('private transient error');return }
      const forwarded=await fetch(collector.endpoint,{ method: 'POST',headers: { 'Content-Type': 'application/json' },body: payload,signal: AbortSignal.timeout(5000) })
      response.writeHead(forwarded.status,{ 'Content-Type': 'application/json' });response.end(await forwarded.text())
    } catch { if (!response.headersSent) response.writeHead(500);response.end() }
  })
  await new Promise((resolve,reject) => { gateway.once('error',reject);gateway.listen(0,'127.0.0.1',resolve) })
  const base=`http://127.0.0.1:${gateway.address().port}`,endpoint=base+'/v1/traces'
  const bun=join(dirname(require.resolve('bun-runtime/package.json')),'bin/bun.exe'),deno=join(dirname(require.resolve('deno-runtime/package.json')),process.platform==='win32' ? 'deno.exe' : 'deno')
  for (const [runtime,binary,flags] of [['node',process.execPath,[]],['bun',bun,[]],['deno',deno,['run','--no-prompt','--no-lock','--node-modules-dir=manual','--allow-env=LONGHORN_OTLP_ENDPOINT,LONGHORN_OTLP_TEST_HEADER','--allow-net=127.0.0.1']]]) {
    const result=(await completed(launch(binary,[...flags,join(root,'scripts/fixtures/run-otlp.mjs')],{ LONGHORN_OTLP_ENDPOINT: endpoint,LONGHORN_OTLP_TEST_HEADER: authorization })))[0]
    assert.equal(result.runtime,runtime);verifyWire(result);console.log(runtime+': collector roundtrip preserves IDs, hierarchy, nanos, enums, scalar types, retry and close.')
  }
  const bundle=join(temporary,'worker')
  await build({ entry: { worker: join(root,'scripts/fixtures/otlp-worker.mjs') },outDir: bundle,bundle: true,splitting: false,platform: 'browser',target: 'es2022',format: ['esm'],silent: true })
  const worker=new Miniflare({ modules: true,modulesRoot: bundle,scriptPath: join(bundle,'worker.js'),host: '127.0.0.1',port: 0,cf: false,compatibilityDate: '2025-07-18',log: new Log(LogLevel.NONE) })
  try {
    const response=await worker.dispatchFetch('https://otlp.example/verify',{ method: 'POST',body: JSON.stringify({ endpoint,authorization }) })
    assert.equal(response.status,200);verifyWire(await response.json());console.log('workers: a browser bundle exports through real workerd Fetch to the native collector and drains inside the request lifetime.')
  } finally { await worker.dispose() }
  const span={ name: 'transport.fixture',kind: 'internal',context: { traceId: '1'.repeat(32),spanId: '2'.repeat(16),sampled: true },parentSpanId: null,startedAt: Date.now(),endedAt: Date.now(),durationMs: 0,status: 'ok',attributes: {} }
  for (const [path,code] of [['/partial','partial'],['/large','response-too-large'],['/permanent','http'],['/redirect','http'],['/timeout','timeout']]) {
    const exporter=new OtlpHttpSpanExporter({ endpoint: base+path,serviceName: 'fault-test',headers: { authorization },timeoutMs: 100,maxResponseBytes: 128 })
    const error=await exporter.export([span]).catch(error => error);assert.equal(error.code,code)
    assert.equal(exporter.stats().requests,1);assert.ok(!String(error).includes('private'));await exporter.close()
  }
  console.log('Native Fetch: partial/permanent/redirect/oversized responses are not retried; a stalled HTTP response expires within the batch deadline.')
  const host=launch(process.execPath,[join(root,'examples/jobs/dist/index.js')],{ HOST: '127.0.0.1',PORT: '0',LOG_LEVEL: 'info',DATABASE_PATH: join(temporary,'jobs.sqlite'),WORKER_ENABLED: 'true',SCHEDULER_ENABLED: 'false',SHUTDOWN_GRACE_MS: '0',
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: '',OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint,OTEL_EXPORTER_OTLP_TRACES_HEADERS: 'authorization='+encodeURIComponent(authorization),OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: '500',OTEL_SERVICE_NAME: 'longhorn-jobs-native',OTEL_SERVICE_VERSION: '1.2.3' })
  const url=(await record(host,value => value.message==='HTTP server listening')).fields.url
  const request=(path,body) => fetch(url+path,{ signal: AbortSignal.timeout(5000),...(body===undefined ? {} : { method: 'POST',headers: { 'Content-Type': 'application/json' },body: JSON.stringify(body) }) })
  const created=await request('/reports',{ numbers: [7,8] });assert.equal(created.status,202);const { job }=await created.json()
  let deadline=Date.now()+5000
  while (true) { const status=await(await request('/reports/'+job.id+'?token=private-query')).json();if (status.job.state==='succeeded') { assert.equal(status.report.sum,15);break }assert.ok(Date.now()<deadline);await new Promise(resolve => setTimeout(resolve,20)) }
  const flushed=await(await request('/traces')).json();assert.deepEqual(flushed.spans,[]);assert.equal(flushed.stats.exportErrors,0)
  rejectExports=true
  await request('/health')
  deadline=Date.now()+4000
  while (true) { const diagnostics=await(await request('/diagnostics')).json();if (diagnostics.traces.exportErrors) { assert.ok(diagnostics.otlp.failedBatches);assert.ok(!JSON.stringify(diagnostics).includes(authorization));break }assert.ok(Date.now()<deadline);await new Promise(resolve => setTimeout(resolve,20)) }
  assert.equal((await request('/readyz')).status,200);assert.equal((await request('/health')).status,200)
  rejectExports=false
  host.child.kill('SIGTERM');await completed(host)
  const records=collector.snapshot().filter(item => service(item)==='longhorn-jobs-native')
  assert.ok(records.some(item => item.span.kind===2));assert.ok(records.some(item => item.span.name==='reports.enqueue'));assert.ok(records.some(item => item.span.name==='reports.process'))
  for (const secret of [authorization,job.id,'private-query']) assert.ok(!JSON.stringify(records).includes(secret))
  assert.ok(!host.output().includes(authorization));assert.ok(host.records.some(value => value.message==='Application stopped'))
  console.log('Reports HTTP: opt-in configuration exports server/producer/consumer spans, excludes input/credentials, isolates collector failure from readiness/work, and drains before process exit.')
} finally {
  await Promise.all(instances.map(dispose))
  if (gateway?.listening) await new Promise(resolve => { gateway.close(resolve);gateway.closeAllConnections() })
  await collector?.stop();await rm(temporary,{ recursive: true,force: true })
}
