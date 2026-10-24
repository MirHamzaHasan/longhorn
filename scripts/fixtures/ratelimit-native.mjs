import assert from 'node:assert/strict'
import { rateLimitContract } from './ratelimit-contract.mjs'
import { RateLimiter,RateLimitError } from '../../packages/ratelimit/dist/index.js'
import { SqliteRateLimitStore,rateLimitMigrations } from '../../packages/ratelimit/dist/sqlite.js'
import { migrate } from '../../packages/database/dist/index.js'
const runtime=globalThis.Deno?'deno':globalThis.Bun?'bun':'node',filename=globalThis.Deno?Deno.args[0]:process.argv[2]
const {openSqlite}=await import('../../runtimes/'+runtime+'/dist/sqlite.js')
const first=await openSqlite({filename}),second=await openSqlite({filename}),limiters=[]
let writing,release
try{
  await migrate(first,rateLimitMigrations)
  let time=100,samples=0,admitted
  const observed={dialect:second.dialect,execute:second.execute.bind(second),close:second.close.bind(second),transaction:work=>{admitted?.();return second.transaction(work)}}
  const one=new RateLimiter({scope:'native.v1',store:new SqliteRateLimitStore(first),limit:2,windowMs:1000,now:()=>{samples++;return time}}),two=new RateLimiter({scope:'native.v1',store:new SqliteRateLimitStore(observed),limit:2,windowMs:1000,now:()=>{samples++;return time}});limiters.push(one,two)
  const values=await Promise.all(Array.from({length:20},(_,i)=>(i%2?one:two).consume('native private account')));assert.equal(values.filter(row=>row.allowed).length,2)
  const row=(await first.execute('SELECT subject_hash,attempts,expires_at FROM longhorn_rate_limit_buckets')).rows[0];assert.match(row.subject_hash,/^[a-f0-9]{64}$/);assert.equal(Number(row.attempts),3);assert.equal(Number(row.expires_at),1100)
  let held=false;const gate=new Promise(done=>{release=done});writing=first.transaction(async tx=>{await tx.execute('UPDATE longhorn_rate_limit_buckets SET attempts=attempts');held=true;await gate});while(!held)await new Promise(done=>setTimeout(done,1))
  let entered;const attempted=new Promise(done=>{entered=done});admitted=entered;const before=samples,waiting=two.consume('native private account');await attempted;assert.equal(samples,before,'Clock sampled before SQL ownership');time=2000;release();await writing;writing=undefined
  assert.deepEqual(await waiting,{allowed:true,remaining:1,resetsAt:3000,retryAfterMs:0});admitted=undefined
  const changed=new RateLimiter({scope:'native.v1',store:new SqliteRateLimitStore(second),limit:3,windowMs:1000,now:()=>time});limiters.push(changed)
  await assert.rejects(changed.consume('native private account'),error=>error instanceof RateLimitError&&error.code==='POLICY_MISMATCH')
  await first.execute('UPDATE longhorn_rate_limit_buckets SET attempts=0,expires_at=NULL,claim=\'foreign\'')
  await assert.rejects(one.consume('native private account'),error=>error.code==='PROTOCOL');await first.execute('DELETE FROM longhorn_rate_limit_buckets')
  for(const subject of ['a','b','c'])await one.consume(subject);time=4000;assert.equal(await one.prune(2),2);assert.equal(await one.prune(2),1)
  console.log(JSON.stringify({runtime,sqlite:true,nativeContention:true,postOwnershipClock:true,pendingFailsClosed:true,...await rateLimitContract()}))
}finally{release?.();await writing?.catch(()=>{});await Promise.all(limiters.map(row=>row.close()));await second.close();await first.close()}
