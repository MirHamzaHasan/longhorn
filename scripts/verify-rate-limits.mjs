import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { Miniflare,Log,LogLevel } from 'miniflare'
import { migrate } from '../packages/database/dist/index.js'
import { migratePostgres } from '../packages/database/dist/postgres.js'
import { RateLimiter,RateLimitError } from '../packages/ratelimit/dist/index.js'
import { SqliteRateLimitStore,rateLimitMigrations } from '../packages/ratelimit/dist/sqlite.js'
import { PostgresRateLimitStore,postgresRateLimitMigrations } from '../packages/ratelimit/dist/postgres.js'
import { openSqlite } from '../runtimes/node/dist/sqlite.js'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { postgresExampleMigrations } from '../examples/postgres/dist/migrations.js'
import { startPostgresSandbox } from './postgres-sandbox.mjs'

const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'longhorn-ratelimit-')),children=[],handles=[],limiters=[],runtimes=[],secrets=[]
let broker,sandbox,writing,release
const sleep=ms=>new Promise(done=>setTimeout(done,ms)),safe=value=>{for(const secret of secrets)value=value.replaceAll(secret,'[redacted]');return value}
const waitFor=async action=>{const end=Date.now()+15000;while(Date.now()<end){if(await action())return;await sleep(10)}throw new Error('Rate limit native condition timed out')}
function child(binary,args,env={}){
  const process=spawn(binary,args,{cwd:root,env:{...globalThis.process.env,...env},stdio:['ignore','pipe','pipe']});let output='';const records=[]
  for(const stream of[process.stdout,process.stderr])createInterface({input:stream}).on('line',line=>{output+=line+'\n';try{records.push(JSON.parse(line))}catch{}})
  process.once('error',()=>{});const instance={process,records,output:()=>output,ended:new Promise(done=>process.once('close',(code,signal)=>done({code,signal})))};children.push(instance);return instance
}
async function run(binary,args){const instance=child(binary,args),timer=setTimeout(()=>instance.process.kill('SIGKILL'),20000);try{assert.equal((await instance.ended).code,0,safe(instance.output()));const value=instance.records.find(row=>row.runtime);assert.ok(value,safe(instance.output()));return value}finally{clearTimeout(timer)}}
const connect=async options=>{const db=await openPostgres(options);handles.push(db);return db}
const limiter=options=>{const value=new RateLimiter(options);limiters.push(value);return value}
async function crashProof(database,kind,location){
  const pg=kind==='postgres',table=pg?'longhorn_rate_limit.buckets':'longhorn_rate_limit_buckets',store=pg?new PostgresRateLimitStore(database):new SqliteRateLimitStore(database)
  for(const mode of['before','after']){
    const instance=child(process.execPath,[join(root,'scripts/fixtures/ratelimit-crash.mjs')],{LIMIT_DRIVER:kind,LIMIT_DATABASE:location,LIMIT_CHECKPOINT:mode})
    await waitFor(()=>{if(instance.process.exitCode!==null)throw new Error(safe(instance.output()));return instance.records.some(row=>row.checkpoint===mode)})
    const count=Number((await database.execute({sql:`SELECT count(*) AS total FROM ${table} WHERE scope=${pg?'$1':'?'}`,args:['crash.'+mode]})).rows[0].total)
    assert.equal(count,mode==='before'?0:1);instance.process.kill('SIGKILL');await instance.ended
    const retry=limiter({scope:'crash.'+mode,store,limit:1,windowMs:86400000});assert.equal((await retry.consume('crash subject')).allowed,mode==='before')
  }
}
try{
  const fixture=join(root,'scripts/fixtures/ratelimit-native.mjs')
  runtimes.push(await run(process.execPath,[fixture,join(temporary,'node.sqlite')]))
  runtimes.push(await run(join(root,'node_modules/bun-runtime/bin/bun.exe'),[fixture,join(temporary,'bun.sqlite')]))
  runtimes.push(await run(join(root,'node_modules/deno-runtime/deno'),['run','--no-prompt','--no-lock','--node-modules-dir=manual','--allow-read='+temporary+','+join(root,'runtimes/deno/dist')+','+join(root,'packages/database/dist'),'--allow-write='+temporary,fixture,join(temporary,'deno.sqlite')]))
  await build({entry:{worker:join(root,'scripts/fixtures/ratelimit-worker.mjs')},outDir:join(temporary,'bundle'),format:['esm'],platform:'browser',target:'es2022',bundle:true,noExternal:[/.*/],splitting:false,clean:true,silent:true})
  const scriptPath=join(temporary,'bundle/worker.js');broker=new Miniflare({modules:true,modulesRoot:dirname(scriptPath),scriptPath,compatibilityDate:'2025-07-18',cf:false,host:'127.0.0.1',port:0,log:new Log(LogLevel.NONE)});await broker.ready
  const response=await broker.dispatchFetch('http://ratelimit/contract',{signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);runtimes.push(await response.json());await broker.dispose();broker=undefined
  assert.deepEqual(runtimes.map(row=>row.runtime),['node','bun','deno','workerd']);assert.ok(runtimes.every(row=>row.quota&&row.hono&&row.reentrantDrain));assert.ok(runtimes.slice(0,3).every(row=>row.sqlite&&row.postOwnershipClock))
  console.log('Rate limits: actual Node/Bun/Deno native SQLite plus finite workerd memory/Hono quota, expiry, policy/capacity, privacy, bounded pruning and owned drain verified.')
  const sqliteFile=join(temporary,'crash.sqlite'),sqlite=await openSqlite({filename:sqliteFile});handles.push(sqlite);await migrate(sqlite,rateLimitMigrations);await crashProof(sqlite,'sqlite',sqliteFile)
  sandbox=await startPostgresSandbox();secrets.push(sandbox.ownerUrl,sandbox.appUrl)
  const owner=await connect({connectionString:sandbox.ownerUrl}),db=await connect({connectionString:sandbox.appUrl}),peer=await connect({connectionString:sandbox.appUrl})
  await migratePostgres(owner,[...postgresExampleMigrations,...postgresRateLimitMigrations],{schema:'longhorn_pg_example'})
  await owner.execute('GRANT USAGE ON SCHEMA longhorn_rate_limit TO longhorn_app');await owner.execute('GRANT SELECT,INSERT,UPDATE ON longhorn_rate_limit.buckets TO longhorn_app')
  let time=100,samples=0,admitted
  const observed={dialect:peer.dialect,execute:peer.execute.bind(peer),close:peer.close.bind(peer),transaction:work=>{admitted?.();return peer.transaction(work)}}
  const one=limiter({scope:'pg.v1',store:new PostgresRateLimitStore(db),limit:3,windowMs:1000,now:()=>{samples++;return time}}),two=limiter({scope:'pg.v1',store:new PostgresRateLimitStore(observed),limit:3,windowMs:1000,now:()=>{samples++;return time}})
  const values=await Promise.all(Array.from({length:40},(_,i)=>(i%2?one:two).consume('private principal')));assert.equal(values.filter(row=>row.allowed).length,3)
  const record=(await owner.execute("SELECT subject_hash,attempts,expires_at FROM longhorn_rate_limit.buckets WHERE scope='pg.v1'")).rows[0];assert.match(record.subject_hash,/^[a-f0-9]{64}$/);assert.equal(record.attempts,4)
  let held=false;const gate=new Promise(done=>{release=done});writing=owner.transaction(async tx=>{await tx.execute("UPDATE longhorn_rate_limit.buckets SET attempts=attempts WHERE scope='pg.v1'");held=true;await gate});await waitFor(()=>held)
  let enter;const attempted=new Promise(done=>{enter=done});admitted=enter;const before=samples,waiting=two.consume('private principal');await attempted;assert.equal(samples,before);time=2000;release();await writing;writing=undefined;assert.deepEqual(await waiting,{allowed:true,remaining:2,resetsAt:3000,retryAfterMs:0});admitted=undefined
  const different=limiter({scope:'pg.v1',store:new PostgresRateLimitStore(db),limit:4,windowMs:1000,now:()=>time});await assert.rejects(different.consume('private principal'),error=>error instanceof RateLimitError&&error.code==='POLICY_MISMATCH')
  await owner.execute('REVOKE UPDATE ON longhorn_rate_limit.buckets FROM longhorn_app');try{await assert.rejects(one.consume('uncommitted subject'));assert.equal((await owner.execute("SELECT count(*)::integer AS total FROM longhorn_rate_limit.buckets WHERE scope='pg.v1'")).rows[0].total,1)}finally{await owner.execute('GRANT UPDATE ON longhorn_rate_limit.buckets TO longhorn_app')}
  const ownerLimiter=limiter({scope:'maintenance',store:new PostgresRateLimitStore(owner),now:()=>time})
  for(const subject of['a','b','c'])await one.consume(subject);time=4000;await assert.rejects(one.prune());assert.equal(await ownerLimiter.prune(2),2);assert.equal(await ownerLimiter.prune(10),2)
  await crashProof(owner,'postgres',sandbox.ownerUrl)
  await mkdir('.artifacts',{recursive:true});await writeFile('.artifacts/rate-limit-proof.json',JSON.stringify({runtimes,postgres:{concurrentAdmitted:3,attempts:40,postOwnershipClock:true,policyMismatch:true,restrictedAdmission:true,rollback:true,maintenanceSeparated:true},nativeCrash:{sqliteBeforeAfter:true,postgresBeforeAfter:true}},null,2)+'\n')
  console.log('Rate limits: restricted PostgreSQL concurrent budgets, post-row-lock clock, policy conflict/permission rollback, separate bounded maintenance and actual SQLite/PostgreSQL SIGKILL before/after commit verified.')
}finally{
  release?.();await writing?.catch(()=>{});for(const instance of children)if(instance.process.exitCode===null&&instance.process.signalCode===null){instance.process.kill('SIGKILL');await instance.ended}
  await Promise.all(limiters.map(row=>row.close()));await broker?.dispose();for(const db of handles.reverse())await db.close();await sandbox?.stop();await rm(temporary,{recursive:true,force:true})
}
