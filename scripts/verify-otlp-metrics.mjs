import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname,join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { build } from 'tsup'
import { Miniflare,Log,LogLevel } from 'miniflare'
import { MetricRegistry } from '../packages/observability/dist/index.js'
import { OtlpHttpMetricExporter } from '../packages/observability/dist/otlp-metrics.js'
import { startOtelCollector } from './otel-collector.mjs'

const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-otlp-metrics-'))
const controller=new AbortController(),instances=new Set(),authorization='Bearer owned-metric-test-only',first=new Map()
let collector,gateway,interrupted=false,rejectMetrics=false,stalledClosed=0
const check=()=>{if(interrupted)throw new Error('Metric gate interrupted')}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{interrupted=true;controller.abort();for(const instance of instances)instance.child.kill('SIGTERM');gateway?.closeAllConnections()})
const waitFor=async action=>{const deadline=Date.now()+12000;while(Date.now()<deadline){check();const value=await action();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20))}throw new Error('Metric gate condition timed out')}
function launch(binary,args,env={}){
  check();const child=spawn(binary,args,{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let output='';const records=[]
  for(const stream of [child.stdout,child.stderr])createInterface({input:stream}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
  child.on('error',()=>{output+='Owned process failed'})
  const instance={child,records,output:()=>output,ended:new Promise(resolve=>child.once('close',(code,signal)=>{instances.delete(instance);resolve({code,signal})}))};instances.add(instance);return instance
}
async function completed(instance){const timer=setTimeout(()=>instance.child.kill('SIGKILL'),30000);try{const result=await instance.ended;assert.equal(result.code,0,instance.output().replaceAll(authorization,'[redacted]'));return instance.records}finally{clearTimeout(timer)}}
async function stop(instance){if(instance.child.exitCode===null&&instance.child.signalCode===null)instance.child.kill('SIGTERM');await completed(instance)}
const service=item=>item.resource.attributes.find(a=>a.key==='service.name')?.value.stringValue
function verifyWire(result){
  const records=collector.metricsSnapshot().filter(item=>service(item)==='longhorn-metrics-'+result.runtime);assert.equal(records.length,14)
  for(const item of records){assert.equal(item.scope.name,'@longhorn/observability');assert.equal(item.scope.version,'0.0.1');assert.ok(item.resource.attributes.some(a=>a.key==='service.instance.id'&&a.value.stringValue===result.runtime+'-native'))}
  const sums=records.filter(item=>item.metric.name==='fixture_requests_total')
  const root=sums.filter(item=>item.metric.sum.dataPoints[0].attributes.some(a=>a.key==='route'&&a.value.stringValue==='/template/0'))
  assert.deepEqual(root.map(item=>item.metric.sum.dataPoints[0].asDouble),[1,11])
  for(const item of sums){assert.equal(item.metric.sum.aggregationTemporality,2);assert.equal(item.metric.sum.isMonotonic,true);assert.equal(item.metric.sum.dataPoints[0].startTimeUnixNano,'1792760000000000000')}
  assert.deepEqual(root.map(item=>item.metric.sum.dataPoints[0].timeUnixNano),['1792760000001000000','1792760000002000000'])
  const histogram=records.find(item=>item.metric.name==='fixture_latency_seconds').metric.histogram
  assert.equal(histogram.aggregationTemporality,2);assert.deepEqual(histogram.dataPoints[0].bucketCounts,['1','1','1','1']);assert.deepEqual(histogram.dataPoints[0].explicitBounds,[0,1,2]);assert.equal(histogram.dataPoints[0].count,'4');assert.equal(histogram.dataPoints[0].sum,5.5)
  assert.equal(records.find(item=>item.metric.name==='fixture_active').metric.gauge.dataPoints[0].asDouble,-0.5)
  assert.ok(records.find(item=>item.metric.name==='fixture_active').metric.gauge.dataPoints[0].attributes.some(a=>a.key==='profile'&&a.value.stringValue==='雪😀'))
  assert.equal(result.exporter.retries,1);assert.equal(result.reader.batches,8);assert.equal(result.reader.state,'closed')
}
try{
  collector=await startOtelCollector({signal:controller.signal})
  gateway=createServer(async(request,response)=>{
    try{
      let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>2097152)throw new Error();chunks.push(chunk)}
      if(request.headers.authorization!==authorization||request.headers.cookie){response.writeHead(401);response.end('private credential detail');return}
      const fault=request.url
      if(fault==='/timeout'||fault==='/body-timeout'){response.on('close',()=>{stalledClosed++});if(fault==='/body-timeout'){response.writeHead(200,{'Content-Type':'application/json'});response.write('{')}return}
      if(fault==='/partial'){response.writeHead(200,{'Content-Type':'application/json'});response.end('{"partialSuccess":{"rejectedDataPoints":"1","errorMessage":"private rejection"}}');return}
      if(fault==='/oversized'){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({extra:'x'.repeat(4096)}));return}
      if(fault==='/permanent'||rejectMetrics){response.writeHead(500);response.end('private collector detail');return}
      if(fault==='/redirect'){response.writeHead(302,{Location:collector.metricsEndpoint});response.end();return}
      const payload=Buffer.concat(chunks).toString('utf8'),name=JSON.parse(payload).resourceMetrics[0].resource.attributes.find(a=>a.key==='service.name').value.stringValue
      if(!first.has(name)){first.set(name,payload);response.writeHead(503,{'Retry-After':'0'});response.end('private transient');return}
      if(typeof first.get(name)==='string'){assert.equal(payload,first.get(name));first.set(name,true)}
      const forwarded=await fetch(collector.metricsEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:payload,signal:AbortSignal.timeout(5000)})
      response.writeHead(forwarded.status,{'Content-Type':'application/json'});response.end(await forwarded.text())
    }catch{if(!response.headersSent)response.writeHead(500);response.end()}
  })
  await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(0,'127.0.0.1',resolve)})
  const endpoint='http://127.0.0.1:'+gateway.address().port+'/v1/metrics',base=new URL(endpoint).origin,require=createRequire(import.meta.url)
  const bun=join(dirname(require.resolve('bun-runtime/package.json')),'bin/bun.exe'),deno=join(dirname(require.resolve('deno-runtime/package.json')),process.platform==='win32'?'deno.exe':'deno')
  for(const[runtime,binary,flags]of[['node',process.execPath,[]],['bun',bun,[]],['deno',deno,['run','--no-prompt','--no-lock','--node-modules-dir=manual','--allow-env=LONGHORN_OTLP_ENDPOINT,LONGHORN_OTLP_TEST_HEADER','--allow-net=127.0.0.1']]]){
    const result=(await completed(launch(binary,[...flags,join(root,'scripts/fixtures/run-otlp-metrics.mjs')],{LONGHORN_OTLP_ENDPOINT:endpoint,LONGHORN_OTLP_TEST_HEADER:authorization})))[0]
    assert.equal(result.runtime,runtime);verifyWire(result);console.log(runtime+': native collector preserves cumulative counter identity, signed gauges, histogram disjoint buckets, point batches, frozen retry and final collection.')
  }
  const bundle=join(temporary,'worker');await build({entry:{worker:join(root,'scripts/fixtures/otlp-metrics-worker.mjs')},outDir:bundle,bundle:true,splitting:false,platform:'browser',target:'es2022',format:['esm'],silent:true})
  const previous=new Map(['SIGINT','SIGTERM'].map(signal=>[signal,new Set(process.listeners(signal))]))
  const worker=new Miniflare({modules:true,modulesRoot:bundle,scriptPath:join(bundle,'worker.js'),host:'127.0.0.1',port:0,cf:false,compatibilityDate:'2025-07-18',log:new Log(LogLevel.NONE)})
  for(const[signal,listeners]of previous)for(const listener of process.listeners(signal))if(!listeners.has(listener))process.removeListener(signal,listener)
  try{const response=await worker.dispatchFetch('http://metrics/verify',{method:'POST',body:JSON.stringify({endpoint,authorization})});assert.equal(response.status,200);verifyWire(await response.json())}finally{await worker.dispose()}
  console.log('workers: actual workerd Fetch sends the same built metric exporter through the real collector; manual flush/close stays inside the request lifetime.')
  const meter=new MetricRegistry();meter.counter({name:'fault_total',help:'Fault fixture.'}).add(1)
  for(const[path,code]of[['/partial','partial'],['/oversized','response-too-large'],['/permanent','http'],['/redirect','http'],['/timeout','timeout'],['/body-timeout','timeout']]){
    const exporter=new OtlpHttpMetricExporter({endpoint:base+path,serviceName:'metrics-fault',headers:{authorization},timeoutMs:100,maxResponseBytes:128})
    const error=await exporter.export(meter.collect()).catch(error=>error);assert.equal(error.code,code);assert.equal(exporter.stats().requests,1);assert.ok(!String(error).includes('private'));await exporter.close()
  }
  await waitFor(()=>stalledClosed===2);meter.close()
  console.log('Native metric Fetch: partial/permanent/redirect/oversized responses do not replay; stalled headers and body expire and release their actual HTTP peers.')
  const host=launch(process.execPath,[join(root,'examples/jobs/dist/index.js')],{HOST:'127.0.0.1',PORT:'0',LOG_LEVEL:'info',DATABASE_PATH:join(temporary,'jobs.sqlite'),WORKER_ENABLED:'true',SCHEDULER_ENABLED:'false',SHUTDOWN_GRACE_MS:'0',OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:'',
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:endpoint,OTEL_EXPORTER_OTLP_METRICS_HEADERS:'authorization='+encodeURIComponent(authorization),OTEL_EXPORTER_OTLP_METRICS_TIMEOUT:'500',OTEL_METRIC_EXPORT_INTERVAL:'100',OTEL_SERVICE_NAME:'longhorn-jobs-metrics',OTEL_SERVICE_INSTANCE_ID:'owned-jobs-instance'})
  const record=await waitFor(()=>{if(host.child.exitCode!==null)throw new Error(host.output().replaceAll(authorization,'[redacted]'));return host.records.find(r=>r.message==='HTTP server listening')})
  const url=record.fields.url,request=(path,body)=>fetch(url+path,{signal:AbortSignal.timeout(5000),...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})})
  const response=await request('/reports',{numbers:[7,8]});assert.equal(response.status,202);const{job}=await response.json()
  await waitFor(async()=>{const value=await(await request('/reports/'+job.id+'?secret=private-query')).json();if(value.job.state!=='succeeded')return false;assert.equal(value.report.sum,15);return true})
  const records=()=>collector.metricsSnapshot().filter(item=>service(item)==='longhorn-jobs-metrics')
  await waitFor(()=>records().some(item=>item.metric.name==='longhorn_job_handlers_total'))
  assert.ok(records().some(item=>item.metric.name==='longhorn_background_active'));assert.ok(records().some(item=>item.metric.name==='longhorn_http_request_duration_seconds'))
  assert.ok((await(await request('/traces')).json()).spans.length>0)
  rejectMetrics=true
  await waitFor(async()=>{const value=await(await request('/diagnostics')).json();return value.otlpMetrics.failedBatches>0&&value.metricReader.failedCollections>0})
  assert.equal((await request('/readyz')).status,200)
  const next=await request('/reports',{numbers:[10,20]});assert.equal(next.status,202);const second=(await next.json()).job
  await waitFor(async()=>{const value=await(await request('/reports/'+second.id)).json();if(value.job.state!=='succeeded')return false;assert.equal(value.report.sum,30);return true})
  rejectMetrics=false
  await waitFor(()=>records().some(item=>item.metric.name==='longhorn_job_handlers_total'&&item.metric.sum.dataPoints[0].asDouble===2))
  const before=collector.stats().receivedMetricPoints;await stop(host);assert.ok(collector.stats().receivedMetricPoints>before);assert.ok(host.records.some(r=>r.message==='Application stopped'))
  for(const secret of[authorization,job.id,second.id,'private-query']){assert.ok(!JSON.stringify(records()).includes(secret));assert.ok(!host.output().includes(authorization))}
  console.log('Reports HTTP: metrics push works without a scrape or remote traces; real persisted jobs/readiness survive collector outage, cumulative totals recover, and shutdown exports final observations before exit.')
}finally{
  for(const instance of instances){if(instance.child.exitCode===null)instance.child.kill('SIGTERM');const timer=setTimeout(()=>instance.child.kill('SIGKILL'),5000);try{await instance.ended}finally{clearTimeout(timer)}}
  if(gateway?.listening)await new Promise(resolve=>{gateway.close(resolve);gateway.closeAllConnections()})
  await collector?.stop();await rm(temporary,{recursive:true,force:true})
}
