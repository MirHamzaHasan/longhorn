import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { rename,writeFile } from 'node:fs/promises'
import { randomBytes,randomUUID } from 'node:crypto'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { Idempotency } from '../packages/idempotency/dist/index.js'
import { PostgresIdempotencyStore } from '../packages/idempotency/dist/postgres.js'
import { Outbox } from '../packages/outbox/dist/index.js'
import { PostgresOutboxStore } from '../packages/outbox/dist/postgres.js'
import { operationData,operationTopic } from '../examples/postgres/dist/operation-contracts.js'

/** Uses only an extracted source artifact and the native gate's provisioned database. */
export async function verifyOperatorPreflight({directory,cli,origin,ownerUrl,appUrl,receiverEnvironment}){
  const instances=[],secrets=[ownerUrl,appUrl,receiverEnvironment.RECEIVER_TOKEN],sleep=ms=>new Promise(done=>setTimeout(done,ms))
  let owner,outbox,delivery,locking,releaseLock,server
  const scope='preflight:readonly',key='expired-reply',commandId=randomUUID()
  const safe=value=>{for(const secret of secrets)value=value.replaceAll(secret,'[redacted]');return value}
  function launch(overrides={}){
    const env={...process.env,MIGRATION_DATABASE_URL:undefined,...overrides};for(const[key,value]of Object.entries(env))if(value===undefined)delete env[key]
    const child=spawn(process.execPath,cli?[cli,'check','--cwd',directory]:['dist/operator-check.js'],{cwd:directory,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});let output='';const records=[]
    for(const stream of[child.stdout,child.stderr])createInterface({input:stream}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
    child.once('error',()=>{});const instance={child,records,output:()=>output,ended:new Promise(done=>child.once('close',(code,signal)=>done({code,signal})))};instances.push(instance);return instance
  }
  async function result(instance,code=0){
    const timer=setTimeout(()=>{try{if(process.platform==='win32')instance.child.kill('SIGKILL');else process.kill(-instance.child.pid,'SIGKILL')}catch{}},20000)
    try{
      assert.equal((await instance.ended).code,code,safe(instance.output()))
      const reports=instance.records.filter(row=>row.schemaVersion===1&&Array.isArray(row.checks));assert.equal(reports.length,1,safe(instance.output()))
      assert.equal(instance.records.length,1,'A check emitted host/service logs')
      for(const secret of secrets)assert.ok(!instance.output().includes(secret),'Preflight exposed supplied data')
      return reports[0]
    }finally{clearTimeout(timer)}
  }
  const run=async(overrides={},code=0)=>result(launch(overrides),code)
  const status=(report,id)=>report.checks.find(row=>row.id===id)?.status
  async function waitFor(action){const end=Date.now()+15000;while(Date.now()<end){if(await action())return;await sleep(20)}throw new Error('Preflight native wait timed out')}
  const observations=[]
  try{
    owner=await openPostgres({connectionString:ownerUrl})
    const requests=new Idempotency({store:new PostgresIdempotencyStore(owner),retentionMs:1,now:()=>0})
    await requests.run({scope,key,input:1},async()=>({expired:true}))
    outbox=new Outbox({name:operationTopic,schema:operationData,store:new PostgresOutboxStore(owner)})
    delivery=await outbox.enqueue({commandId,numbers:[4,5]})
    const snapshot=async()=>(await owner.execute(`SELECT
      (SELECT count(*) FROM longhorn_pg_example.tasks) AS tasks,
      (SELECT count(*) FROM longhorn_auth.users) AS users,
      (SELECT count(*) FROM longhorn_auth.sessions) AS sessions,
      (SELECT count(*) FROM longhorn_pg_example.operator_commands) AS commands,
      (SELECT count(*) FROM longhorn_queue.jobs) AS jobs,
      (SELECT count(*) FROM longhorn_idempotency.requests) AS replays,
      (SELECT count(*) FROM longhorn_outbox.recovery_audit) AS audit,
      (SELECT count(*) FROM longhorn_pg_example.history_views) AS views`)).rows[0]
    const before=await snapshot(),good=await run();assert.equal(good.ready,true);assert.equal(good.cancelled,false);assert.ok(good.checks.every(row=>row.status==='passed'));assert.equal(good.capabilities.requestCleanupEnabled,true);observations.push('ready')
    for(const overrides of[{PORT:'invalid'},{MIGRATION_DATABASE_URL:ownerUrl}]){const report=await run(overrides,1);assert.equal(status(report,'configuration'),'failed');assert.equal(status(report,'database'),'skipped');observations.push('configuration')}
    const asset=join(directory,'dist/console/app.css');await rename(asset,asset+'.held')
    try{const report=await run({},1);assert.equal(status(report,'console-assets'),'failed');assert.equal(status(report,'database-close'),'passed');assert.equal(status(report,'receiver'),'passed');observations.push('assets')}finally{await rename(asset+'.held',asset)}
    const wrong=new URL(appUrl);wrong.password=randomBytes(24).toString('hex');secrets.push(wrong.href,wrong.password)
    let report=await run({DATABASE_URL:wrong.href},1);assert.equal(status(report,'database'),'failed');assert.equal(status(report,'schema'),'skipped');assert.equal(status(report,'receiver'),'passed');observations.push('connection')
    report=await run({DATABASE_URL:ownerUrl},1);assert.equal(status(report,'schema'),'passed');assert.equal(status(report,'runtime-role'),'failed');observations.push('owner-denied')
    await owner.execute('REVOKE SELECT ON longhorn_pg_example.tasks FROM starter_app')
    try{report=await run({},1);assert.equal(status(report,'schema'),'failed');assert.equal(status(report,'runtime-role'),'skipped');observations.push('grant')}finally{await owner.execute('GRANT SELECT ON longhorn_pg_example.tasks TO starter_app')}
    await owner.execute('ALTER TABLE longhorn_pg_example.history_views RENAME TO preflight_held_views')
    try{report=await run({},1);assert.equal(status(report,'schema'),'failed');observations.push('missing-schema')}finally{await owner.execute('ALTER TABLE longhorn_pg_example.preflight_held_views RENAME TO history_views')}
    await owner.execute('REVOKE DELETE ON longhorn_idempotency.requests FROM starter_app')
    try{
      report=await run({},1);assert.equal(status(report,'schema'),'failed')
      report=await run({REQUEST_CLEANUP_ENABLED:'false'});assert.equal(report.ready,true);assert.equal(report.capabilities.requestCleanupEnabled,false);observations.push('cleanup-opt-in')
    }finally{await owner.execute('GRANT DELETE ON longhorn_idempotency.requests TO starter_app')}
    const badToken=randomBytes(32).toString('hex');secrets.push(badToken);report=await run({MESSAGE_SERVICE_TOKEN:badToken},1);assert.equal(status(report,'receiver'),'failed');observations.push('credential')
    let mode='malformed',seen=0,authorized=false;const responseSecret='private-health-'+randomBytes(16).toString('hex');secrets.push(responseSecret)
    server=createServer((request,response)=>{seen++;authorized=request.headers.authorization==='Bearer '+receiverEnvironment.RECEIVER_TOKEN;if(mode==='malformed'){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({ready:true,extra:responseSecret}))}})
    await new Promise(done=>server.listen(0,'127.0.0.1',done));const service='http://127.0.0.1:'+server.address().port+'/'
    for(const current of['malformed','timeout']){mode=current;report=await run({MESSAGE_SERVICE_URL:service,MESSAGE_HTTP_TIMEOUT_MS:'100'},1);assert.equal(status(report,'receiver'),'failed');assert.equal(status(report,'database-close'),'passed');observations.push(current)}
    assert.ok(seen>=2&&authorized);server.closeAllConnections();await new Promise(done=>server.close(done));server=undefined
    // Interrupt a real admitted schema SELECT, then release it before pool closure can finish.
    let held=false,pid;const gate=new Promise(done=>{releaseLock=done})
    locking=owner.transaction(async tx=>{pid=(await tx.execute('SELECT pg_backend_pid() AS pid')).rows[0].pid;await tx.execute('LOCK TABLE longhorn_pg_example.tasks IN ACCESS EXCLUSIVE MODE');held=true;await gate});await waitFor(()=>held)
    const interrupted=launch();await waitFor(async()=>(await owner.execute({sql:'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::integer=ANY(pg_blocking_pids(pid))) AS blocked',args:[pid]})).rows[0].blocked===true)
    interrupted.child.kill('SIGTERM');await sleep(100);assert.equal(interrupted.child.exitCode,null);assert.equal(interrupted.records.length,0)
    releaseLock();await locking;locking=undefined;report=await result(interrupted,143);assert.equal(report.cancelled,true);assert.equal(status(report,'schema'),'cancelled');assert.equal(status(report,'receiver'),'skipped');assert.equal(status(report,'database-close'),'passed');observations.push('interrupted-drain')
    assert.deepEqual(await snapshot(),before)
    const job=(await owner.execute({sql:'SELECT state,attempts FROM longhorn_queue.jobs WHERE id=$1',args:[delivery.id]})).rows[0];assert.equal(job.state,'pending');assert.equal(job.attempts,0)
    const receipt=await fetch('http://127.0.0.1:'+receiverEnvironment.PORT+'/receipts/'+commandId,{headers:{Authorization:'Bearer '+receiverEnvironment.RECEIVER_TOKEN},signal:AbortSignal.timeout(3000)});assert.equal(receipt.status,404)
    await assert.rejects(fetch(origin+'/livez',{signal:AbortSignal.timeout(1000)}))
    const recovered=await run();assert.equal(recovered.ready,true)
    await writeFile('.artifacts/operator-preflight-proof'+(cli?'-cli':'-archive')+'.json',JSON.stringify({observations,readyAfterRecovery:true,readOnlyCounts:true,pendingDeliveryUnsent:true,expiredReplayUnpruned:true,noAppListener:true,oneSanitizedReport:true,actualSqlDrain:true,cli:!!cli},null,2)+'\n')
    console.log('Operator preflight: actual '+(cli?'installed CLI':'archive executable')+' config/assets/connection/schema/grants/role/cleanup/receiver failures, strict timeout/privacy, native interrupted SQL drain and unchanged pending/replay/business state verified.')
  }finally{
    releaseLock?.();await locking?.catch(()=>{});server?.closeAllConnections();if(server)await new Promise(done=>server.close(done))
    for(const instance of instances)if(instance.child.exitCode===null&&instance.child.signalCode===null){instance.child.kill('SIGTERM');await instance.ended}
    await outbox?.close()
    if(owner){if(delivery)await owner.execute({sql:'DELETE FROM longhorn_queue.jobs WHERE id=$1',args:[delivery.id]});await owner.execute({sql:'DELETE FROM longhorn_idempotency.requests WHERE scope=$1 AND request_key=$2',args:[scope,key]});await owner.close()}
  }
}
