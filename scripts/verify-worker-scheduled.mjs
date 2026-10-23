import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname,join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { Miniflare,Log,LogLevel } from 'miniflare'
const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-worker-scheduled-'))
const workers=[],held=new Map();let gateway,host,hostEnded
const waitFor=async predicate => {
  const deadline=Date.now()+5000
  while (Date.now()<deadline) { const value=await predicate();if (value) return value;await new Promise(resolve => setTimeout(resolve,10)) }
  throw new Error('Scheduled native condition did not settle')
}
async function make(scriptPath,bindings={},extra={}) {
  const worker=new Miniflare({ modules: true,modulesRoot: dirname(scriptPath),scriptPath,compatibilityDate: '2025-07-18',host: '127.0.0.1',port: 0,cf: false,log: new Log(LogLevel.NONE),bindings,...extra })
  workers.push(worker);await worker.ready;return worker
}
const state=async worker => (await worker.dispatchFetch('http://scheduled.example/_fixture/state')).json()
const release=key => { const response=held.get(key);assert.ok(response,'Missing owned gate '+key);held.delete(key);response.end('released') }
try {
  gateway=createServer((request,response) => { held.set(request.url,response);response.on('close',() => { if (held.get(request.url)===response) held.delete(request.url) }) })
  await new Promise(resolve => gateway.listen(0,'127.0.0.1',resolve))
  const bundle=join(temporary,'fixture')
  await build({ entry: { worker: join(root,'scripts/fixtures/worker-scheduled.mjs') },outDir: bundle,bundle: true,splitting: false,platform: 'browser',target: 'es2022',format: ['esm'],silent: true })
  const worker=await make(join(bundle,'worker.js'),{ NAME: 'native-worker',GATE_URL: `http://127.0.0.1:${gateway.address().port}` }),service=await worker.getWorker()
  const tick=(cron,time=Date.now()) => service.scheduled({ cron,scheduledTime: new Date(time) })
  assert.equal((await tick('* * * * *',123000)).outcome,'ok')
  assert.equal((await(await worker.dispatchFetch('http://scheduled.example/health')).json()).name,'native-worker')
  let snapshot=await state(worker);assert.equal(snapshot.starts,1);assert.equal(snapshot.stops,0)
  assert.deepEqual(snapshot.events[0],{ cron: '* * * * *',time: 123000,name: 'native-worker' })
  const one=tick('hold-a',1000),two=tick('hold-b',2000)
  await waitFor(() => held.has('/hold-a')&&held.has('/hold-b'))
  const overflow=await tick('overflow');assert.notEqual(overflow.outcome,'ok');assert.equal(overflow.noRetry,false)
  assert.equal((await state(worker)).invocations.active,2)
  release('/hold-a');release('/hold-b');assert.ok((await Promise.all([one,two])).every(result => result.outcome==='ok'))
  assert.equal((await tick('permanent')).noRetry,true)
  const failure=await tick('failure');assert.notEqual(failure.outcome,'ok');assert.equal(failure.noRetry,false)
  const flush=tick('flush');await waitFor(() => held.has('/flush'));assert.equal((await state(worker)).invocations.active,1)
  release('/flush');assert.equal((await flush).outcome,'ok')
  const cooperative=tick('cooperative-budget');await waitFor(() => held.has('/cooperative-budget'))
  assert.notEqual((await cooperative).outcome,'ok')
  assert.ok((await state(worker)).invocations.timedOut>=1)
  const ignored=tick('ignore-budget');await waitFor(() => held.has('/ignore-budget'))
  await waitFor(async () => (await state(worker)).invocations.timedOut>=2)
  snapshot=await state(worker);assert.equal(snapshot.invocations.active,1);assert.equal(snapshot.released,false)
  let closed=false
  const closing=worker.dispatchFetch('http://scheduled.example/_fixture/close').then(async response => { closed=true;return response.json() })
  await waitFor(async () => (await state(worker)).invocations.closing)
  assert.equal(closed,false);assert.equal((await state(worker)).released,false)
  release('/ignore-budget');assert.notEqual((await ignored).outcome,'ok')
  assert.deepEqual(await closing,{ released: true,stops: 1 })
  const late=await tick('* * * * *');assert.notEqual(late.outcome,'ok')
  console.log('workerd: actual scheduled controllers/context, one shared startup, overlapping admission, retry suppression, failures, telemetry drain, cooperative budget and resource ownership through close verified.')

  const script=join(root,'examples/scheduled-worker/dist/index.js'),persist=join(temporary,'kv')
  const example=await make(script,{}, { kvNamespaces: ['AUDIT'],kvPersist: persist }),exampleService=await example.getWorker(),scheduledTime=1790000000000
  assert.equal((await exampleService.scheduled({ cron: '* * * * *',scheduledTime: new Date(scheduledTime) })).outcome,'ok')
  const audit=(await(await example.dispatchFetch('http://scheduled.example/scheduled/last')).json()).audit
  assert.equal(audit.scheduledTime,scheduledTime);assert.equal(audit.cron,'* * * * *');assert.ok(audit.jobId.startsWith('scheduled:audit.'))
  assert.equal((await exampleService.scheduled({ cron: '* * * * *',scheduledTime: new Date(scheduledTime) })).outcome,'ok')
  const kv=await example.getKVNamespace('AUDIT'),keys=await kv.list({ prefix: 'events/' });assert.equal(keys.keys.length,1)
  const traces=await(await example.dispatchFetch('http://scheduled.example/traces')).json();assert.equal(traces.spans.length,2)
  assert.ok(traces.spans.every(span => span.name==='scheduled.audit'&&span.kind==='consumer'))
  assert.ok(!JSON.stringify(traces).includes(audit.jobId));assert.ok(!JSON.stringify(traces).includes(audit.cron))
  workers.splice(workers.indexOf(example),1);await example.dispose()
  const restarted=await make(script,{}, { kvNamespaces: ['AUDIT'],kvPersist: persist })
  assert.deepEqual((await(await restarted.dispatchFetch('http://scheduled.example/scheduled/last')).json()).audit,audit)
  assert.equal((await(await restarted.dispatchFetch('http://scheduled.example/scheduled')).json()).invocations.succeeded,0)
  assert.equal((await(await restarted.getWorker()).scheduled({ cron: '* * * * *',scheduledTime: new Date(scheduledTime) })).outcome,'ok')
  assert.equal((await(await restarted.getKVNamespace('AUDIT')).list({ prefix: 'events/' })).keys.length,1)
  assert.deepEqual((await(await restarted.dispatchFetch('http://scheduled.example/scheduled/last')).json()).audit,audit)
  const missing=await make(script),missingResult=await(await missing.getWorker()).scheduled({ cron: '* * * * *' })
  assert.notEqual(missingResult.outcome,'ok');assert.equal(missingResult.noRetry,true)
  console.log('Audit example: one bounded queue/schedule pipeline per platform delivery, stable replayed KV effect, trace privacy, persisted KV across isolate restart, fresh in-memory state and missing-binding policy verified.')

  const records=[];let output=''
  host=spawn(process.execPath,[join(root,'scripts/serve-scheduled-worker.mjs')],{ cwd: root,env: { ...process.env,HOST: '127.0.0.1',PORT: '0' },stdio: ['ignore','pipe','pipe'] })
  createInterface({ input: host.stdout }).on('line',line => { output+=line+'\n';try { records.push(JSON.parse(line)) } catch {} })
  host.stderr.on('data',chunk => { output+=chunk });host.on('error',error => { output+=String(error) })
  hostEnded=new Promise(resolve => host.once('close',(code,signal) => resolve({ code,signal })))
  const address=(await waitFor(() => records.find(value => value.message==='HTTP server listening'))).fields.url
  const response=await fetch(address+'/cdn-cgi/mf/scheduled?cron=*+*+*+*+*&time='+scheduledTime,{ signal: AbortSignal.timeout(5000) })
  assert.equal(response.status,200)
  assert.equal((await(await fetch(address+'/scheduled/last')).json()).audit.scheduledTime,scheduledTime)
  host.kill('SIGTERM');const timer=setTimeout(() => host.kill('SIGKILL'),7000)
  try { assert.equal((await hostEnded).code,0,output) } finally { clearTimeout(timer) }
  assert.ok(records.some(value => value.message==='Application stopped'));await assert.rejects(fetch(address+'/health',{ signal: AbortSignal.timeout(1000) }))
  console.log('Local launcher: the pinned Miniflare scheduled-control endpoint invokes real workerd, serves the KV result, and exits cleanly on SIGTERM.')
} finally {
  for (const response of held.values()) response.end('cleanup');held.clear()
  if (host && host.exitCode===null && host.signalCode===null) host.kill('SIGKILL')
  await hostEnded
  const cleaned=await Promise.allSettled(workers.map(worker => worker.dispose()))
  try { if (gateway?.listening) await new Promise(resolve => { gateway.close(resolve);gateway.closeAllConnections() }) }
  finally { await rm(temporary,{ recursive: true,force: true }) }
  const failures=cleaned.filter(result => result.status==='rejected').map(result => result.reason)
  if (failures.length) throw new AggregateError(failures,'Owned Worker cleanup failed')
}
