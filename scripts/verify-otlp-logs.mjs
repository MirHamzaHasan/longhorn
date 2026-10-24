import { localReportTestEnvironment } from './local-report-test-environment.mjs'
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
import { BufferedLogProcessor } from '../packages/observability/dist/index.js'
import { OtlpHttpLogExporter } from '../packages/observability/dist/otlp-logs.js'
import { startOtelCollector } from './otel-collector.mjs'
const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-otlp-logs-')),controller=new AbortController()
const instances=new Set(),processors=new Set(),exporters=new Set(),authorization='Bearer owned-log-test-only',first=new Map(),held=new Set()
let collector,gateway,interrupted=false,rejectLogs=false,heldReleased=false,stalledClosed=0,heldCommits=0
const check=()=>{if(interrupted)throw new Error('Log gate interrupted')}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{interrupted=true;controller.abort();for(const instance of instances)instance.child.kill('SIGTERM');gateway?.closeAllConnections()})
const waitFor=async action=>{const end=Date.now()+12000;while(Date.now()<end){check();const value=await action();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20))}throw new Error('Log gate condition timed out')}
function launch(binary,args,env={}){
  check();const child=spawn(binary,args,{cwd:root,env:{...process.env,...localReportTestEnvironment,...env},stdio:['ignore','pipe','pipe']});let output='';const records=[]
  for(const stream of [child.stdout,child.stderr])createInterface({input:stream}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
  child.on('error',()=>{output+='Owned process failed'})
  const instance={child,records,output:()=>output,ended:new Promise(resolve=>child.once('close',(code,signal)=>{instances.delete(instance);resolve({code,signal})}))};instances.add(instance);return instance
}
async function completed(instance){const timer=setTimeout(()=>instance.child.kill('SIGKILL'),30000);try{const result=await instance.ended;assert.equal(result.code,0,instance.output().replaceAll(authorization,'[redacted]'));return instance.records}finally{clearTimeout(timer)}}
const service=item=>item.resource.attributes.find(a=>a.key==='service.name')?.value.stringValue
function verifyWire(result){
  const records=collector.logsSnapshot().filter(item=>service(item)==='longhorn-logs-'+result.runtime);assert.equal(records.length,4)
  assert.deepEqual(records.map(item=>item.log.severityNumber),[5,9,13,17]);assert.deepEqual(records.map(item=>item.log.severityText),['debug','info','warn','error'])
  for(const item of records){assert.equal(item.scope.name,'@longhorn/observability');assert.equal(item.log.timeUnixNano,'1792760000000000000');assert.equal(item.log.observedTimeUnixNano,'1792760000010250000')}
  const debug=records[0].log,attributes=Object.fromEntries(debug.attributes.map(a=>[a.key,a.value]))
  assert.deepEqual(attributes.integer,{intValue:'42'});assert.deepEqual(attributes.fraction,{doubleValue:1.5});assert.deepEqual(attributes.yes,{boolValue:true})
  assert.deepEqual(attributes.array,{arrayValue:{values:[{intValue:'1'},{stringValue:'雪😀'},{}]}})
  assert.deepEqual(attributes.object,{kvlistValue:{values:[{key:'status',value:{stringValue:'ok'}}]}});assert.deepEqual(attributes.password,{stringValue:'[Redacted]'})
  assert.equal(debug.traceId,'1'.repeat(32));assert.equal(debug.spanId,'2'.repeat(16));assert.equal(debug.flags&1,1)
  assert.ok(!records[2].log.traceId);assert.ok(!JSON.stringify(records).includes('private-log-sentinel'))
  assert.equal(result.processor.exported,4);assert.equal(result.exporter.retries,1);assert.equal(result.exporter.acceptedLogRecords,4)
}
const entry=message=>({record:{timestamp:'2026-10-23T12:00:00.000Z',level:'info',message,fields:{}},observedAt:Date.now()})
function exporter(options){const value=new OtlpHttpLogExporter(options);exporters.add(value);return value}
function releaseHeld(){heldReleased=true;for(const response of held){if(!response.destroyed){response.writeHead(200,{'Content-Type':'application/json'});response.end('{}')}}held.clear()}
try{
  collector=await startOtelCollector({signal:controller.signal})
  gateway=createServer(async(request,response)=>{
    try{
      let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>2097152)throw new Error();chunks.push(chunk)}
      if(request.headers.authorization!==authorization||request.headers.cookie){response.writeHead(401);response.end('private auth detail');return}
      const fault=request.url
      if(fault==='/timeout'||fault==='/body-timeout'){response.on('close',()=>{stalledClosed++});if(fault==='/body-timeout'){response.writeHead(200,{'Content-Type':'application/json'});response.write('{')}return}
      if(fault==='/partial'){response.writeHead(200,{'Content-Type':'application/json'});response.end('{"partialSuccess":{"rejectedLogRecords":"1","errorMessage":"private rejection"}}');return}
      if(fault==='/oversized'){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({extra:'x'.repeat(4096)}));return}
      if(fault==='/permanent'||rejectLogs){response.writeHead(500);response.end('private collector detail');return}
      if(fault==='/redirect'){response.writeHead(302,{Location:collector.logsEndpoint});response.end();return}
      const payload=Buffer.concat(chunks).toString('utf8'),name=JSON.parse(payload).resourceLogs[0].resource.attributes.find(a=>a.key==='service.name').value.stringValue
      if(fault!=='/hold'&&fault!=='/ambiguous'){
        if(!first.has(name)){first.set(name,payload);response.writeHead(503,{'Retry-After':'0'});response.end('private transient');return}
        if(typeof first.get(name)==='string'){assert.equal(payload,first.get(name));first.set(name,true)}
      }
      const forwarded=await fetch(collector.logsEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:payload,signal:AbortSignal.timeout(5000)}),reply=await forwarded.text()
      if(fault==='/hold'){heldCommits++;if(!heldReleased){held.add(response);return}}
      if(fault==='/ambiguous'){response.on('close',()=>{stalledClosed++});return}
      response.writeHead(forwarded.status,{'Content-Type':'application/json'});response.end(reply)
    }catch{if(!response.headersSent)response.writeHead(500);response.end()}
  })
  await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(0,'127.0.0.1',resolve)})
  const base='http://127.0.0.1:'+gateway.address().port,endpoint=base+'/v1/logs',require=createRequire(import.meta.url)
  const bun=join(dirname(require.resolve('bun-runtime/package.json')),'bin/bun.exe'),deno=join(dirname(require.resolve('deno-runtime/package.json')),process.platform==='win32'?'deno.exe':'deno')
  for(const[runtime,binary,flags]of[['node',process.execPath,[]],['bun',bun,[]],['deno',deno,['run','--no-prompt','--no-lock','--node-modules-dir=manual','--allow-env=LONGHORN_OTLP_ENDPOINT,LONGHORN_OTLP_TEST_HEADER','--allow-net=127.0.0.1']]]){
    const result=(await completed(launch(binary,[...flags,join(root,'scripts/fixtures/run-otlp-logs.mjs')],{LONGHORN_OTLP_ENDPOINT:endpoint,LONGHORN_OTLP_TEST_HEADER:authorization})))[0]
    assert.equal(result.runtime,runtime);verifyWire(result);console.log(runtime+': real collector preserves log severities, event/observed nanos, nested typed fields, redaction, explicit trace context, identical-byte retry and final drain.')
  }
  const bundle=join(temporary,'worker');await build({entry:{worker:join(root,'scripts/fixtures/otlp-logs-worker.mjs')},outDir:bundle,bundle:true,splitting:false,platform:'browser',target:'es2022',format:['esm'],silent:true})
  const previous=new Map(['SIGINT','SIGTERM'].map(signal=>[signal,new Set(process.listeners(signal))]))
  const worker=new Miniflare({modules:true,modulesRoot:bundle,scriptPath:join(bundle,'worker.js'),host:'127.0.0.1',port:0,cf:false,compatibilityDate:'2025-07-18',log:new Log(LogLevel.NONE)})
  for(const[signal,listeners]of previous)for(const listener of process.listeners(signal))if(!listeners.has(listener))process.removeListener(signal,listener)
  try{const response=await worker.dispatchFetch('http://logs/verify',{method:'POST',body:JSON.stringify({endpoint,authorization})});assert.equal(response.status,200);verifyWire(await response.json())}finally{await worker.dispose()}
  console.log('workers: browser-bundled log delivery runs through actual workerd and the native collector; final drain completes inside the request lifetime.')
  for(const[path,code]of[['/partial','partial'],['/oversized','response-too-large'],['/permanent','http'],['/redirect','http'],['/timeout','timeout'],['/body-timeout','timeout']]){
    const value=exporter({endpoint:base+path,serviceName:'logs-fault',headers:{authorization},timeoutMs:100,maxResponseBytes:128})
    const error=await value.export([entry('fault')]).catch(error=>error);assert.equal(error.code,code);assert.equal(value.stats().requests,1);assert.ok(!String(error).includes('private'));await value.close()
  }
  const before=collector.stats().receivedLogRecords,ambiguous=exporter({endpoint:base+'/ambiguous',serviceName:'logs-ambiguous',headers:{authorization},timeoutMs:200})
  await assert.rejects(ambiguous.export([entry('committed before lost acknowledgement')]),error=>error.code==='timeout');await ambiguous.close()
  assert.equal(collector.stats().receivedLogRecords,before+1);assert.equal(ambiguous.stats().acceptedLogRecords,0);assert.equal(ambiguous.stats().requests,1);await waitFor(()=>stalledClosed===3)
  const heldExporter=exporter({endpoint:base+'/hold',serviceName:'logs-capacity',headers:{authorization},timeoutMs:3000}),bounded=new BufferedLogProcessor({exporter:heldExporter,maxBufferedRecords:2,maxBufferedBytes:512,maxRecordBytes:256,maxBatchBytes:256,maxBatchRecords:1});processors.add(bounded)
  bounded.sink(entry('one').record);await waitFor(()=>heldCommits===1)
  for(let i=0;i<20;i++)bounded.sink(entry('later').record)
  assert.equal(bounded.stats().accepted,2);assert.equal(bounded.stats().capacityDrops,19);assert.equal(bounded.stats().inFlight,1);assert.ok(bounded.stats().bufferedBytes<=512)
  releaseHeld();await bounded.close();assert.equal(bounded.stats().exported,2)
  console.log('Native log Fetch/buffer: partial/permanent/redirect/oversized responses do not replay; stalled peers close at deadline, lost acknowledgement remains ambiguous, and in-flight work counts against bounded admission.')
  const host=launch(process.execPath,[join(root,'examples/jobs/dist/index.js')],{HOST:'127.0.0.1',PORT:'0',LOG_LEVEL:'info',DATABASE_PATH:join(temporary,'jobs.sqlite'),WORKER_ENABLED:'true',SCHEDULER_ENABLED:'false',SHUTDOWN_GRACE_MS:'0',OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:'',OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:'',
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT:endpoint,OTEL_EXPORTER_OTLP_LOGS_HEADERS:'authorization='+encodeURIComponent(authorization),OTEL_EXPORTER_OTLP_LOGS_TIMEOUT:'500',OTEL_SERVICE_NAME:'longhorn-jobs-logs',OTEL_SERVICE_INSTANCE_ID:'owned-jobs-logs'})
  const started=await waitFor(()=>{if(host.child.exitCode!==null)throw new Error(host.output().replaceAll(authorization,'[redacted]'));return host.records.find(r=>r.message==='HTTP server listening')})
  const url=started.fields.url,request=(path,body)=>fetch(url+path,{signal:AbortSignal.timeout(5000),...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})})
  const response=await request('/reports',{numbers:[7,8]});assert.equal(response.status,202);const{job}=await response.json()
  await waitFor(async()=>{const value=await(await request('/reports/'+job.id+'?secret=private-query')).json();if(value.job.state!=='succeeded')return false;assert.equal(value.report.sum,15);return true})
  const records=()=>collector.logsSnapshot().filter(item=>service(item)==='longhorn-jobs-logs')
  await waitFor(()=>records().some(item=>item.log.body?.stringValue==='HTTP request completed'))
  const traces=(await(await request('/traces')).json()).spans
  assert.ok(records().some(item=>traces.some(span=>span.context.traceId===item.log.traceId&&span.context.spanId===item.log.spanId)))
  rejectLogs=true;await request('/health')
  await waitFor(async()=>{const value=await(await request('/diagnostics')).json();return value.logs.failedBatches>0})
  assert.equal((await request('/readyz')).status,200)
  const next=await request('/reports',{numbers:[10,20]});assert.equal(next.status,202);const second=(await next.json()).job
  await waitFor(async()=>{const value=await(await request('/reports/'+second.id)).json();if(value.job.state!=='succeeded')return false;assert.equal(value.report.sum,30);return true})
  rejectLogs=false;const previousCount=records().length;await request('/health');await waitFor(()=>records().length>previousCount)
  host.child.kill('SIGTERM');await completed(host);assert.ok(records().some(item=>item.log.body?.stringValue==='Application stopped'))
  assert.ok(host.records.some(r=>r.message==='Log export failed'));assert.ok(!records().some(item=>item.log.body?.stringValue==='Log export failed'))
  for(const secret of[authorization,job.id,second.id,'private-query'])assert.ok(!JSON.stringify(records()).includes(secret))
  assert.ok(!host.output().includes(authorization))
  console.log('Reports HTTP: local console and projected remote logs coexist, log trace IDs match real spans, SQLite work/readiness survive collector outage, later logs recover and final application-stop output drains before exit.')
}finally{
  releaseHeld()
  for(const instance of instances){if(instance.child.exitCode===null)instance.child.kill('SIGTERM');const timer=setTimeout(()=>instance.child.kill('SIGKILL'),5000);try{await instance.ended}finally{clearTimeout(timer)}}
  await Promise.allSettled([...processors].map(value=>value.close()));await Promise.allSettled([...exporters].map(value=>value.close()))
  if(gateway?.listening)await new Promise(resolve=>{gateway.close(resolve);gateway.closeAllConnections()})
  await collector?.stop();await rm(temporary,{recursive:true,force:true})
}
