import { expect,it,vi } from 'vitest'
import type { BatchDatabase,QueryResult } from '@longhornjs/database'
import { RateLimiter,RateLimitError } from './index.js'
import { BatchSqliteRateLimitStore } from './batch-sqlite.js'
const request={scope:'tasks.v1',key:'a'.repeat(64),limit:2,windowMs:1000},row={policy_limit:2,window_ms:1000,attempts:1,expires_at:2000,observed_at:1000}
function fixture(result:QueryResult={rows:[row],rowsAffected:1,lastInsertId:undefined}){
  const execute=vi.fn(async()=>result),close=vi.fn(async()=>{}),batch=vi.fn(async()=>[]),database:BatchDatabase={dialect:'sqlite',execute,batch,close}
  return{database,store:new BatchSqliteRateLimitStore(database),execute,close,batch}
}
it('uses one bound native reservation and returns server-observed time without a client clock',async()=>{
  const state=fixture(),limiter=new RateLimiter({store:state.store,scope:request.scope,limit:2,windowMs:1000})
  expect(await limiter.consume('private subject')).toEqual({allowed:true,remaining:1,resetsAt:2000,retryAfterMs:0});expect(state.execute).toHaveBeenCalledOnce();expect(JSON.stringify(state.execute.mock.calls)).not.toContain('private subject');expect(state.batch).not.toHaveBeenCalled();await limiter.close();expect(state.close).not.toHaveBeenCalled()
})
it('keeps denied and mismatched policy results distinct without a follow-up read',async()=>{
  expect(await fixture({rows:[{...row,attempts:3}],rowsAffected:1,lastInsertId:undefined}).store.consume(request)).toMatchObject({allowed:false,remaining:0,observedAt:1000})
  const state=fixture({rows:[],rowsAffected:0,lastInsertId:undefined});await expect(state.store.consume(request)).rejects.toMatchObject({code:'POLICY_MISMATCH'});expect(state.execute).toHaveBeenCalledOnce()
})
it('rejects malformed native counters/time/acknowledgements',async()=>{
  for(const result of [
    {rows:[],rowsAffected:1},{rows:[row],rowsAffected:0},{rows:[row,row],rowsAffected:2},
    ...[{policy_limit:3},{window_ms:2000},{attempts:0},{attempts:4},{observed_at:-1},{observed_at:NaN},{expires_at:1000},{expires_at:'2000'}].map(extra=>({rows:[{...row,...extra}],rowsAffected:1})),
  ])await expect(fixture({...result,lastInsertId:undefined}).store.consume(request)).rejects.toMatchObject({code:'PROTOCOL'})
})
it('bounds table-wide native-time pruning without closing the borrowed database',async()=>{
  const state=fixture({rows:[],rowsAffected:2,lastInsertId:undefined});expect(await state.store.prune({limit:2})).toBe(2);await expect(state.store.prune({limit:1})).rejects.toMatchObject({code:'PROTOCOL'});await expect(state.store.prune({limit:0})).rejects.toMatchObject({code:'INPUT'});expect(state.execute).toHaveBeenCalledTimes(2);expect(state.close).not.toHaveBeenCalled()
})
it('retains actual native failures and owns admitted work until limiter close',async()=>{
  let release!:(result:QueryResult)=>void,entered=false,closed=false;const state=fixture();state.database.execute=()=>{entered=true;return new Promise(done=>{release=done})}
  const limiter=new RateLimiter({store:state.store,scope:request.scope,limit:2,windowMs:1000}),work=limiter.consume('subject');await vi.waitFor(()=>expect(entered).toBe(true));const closing=limiter.close().then(()=>{closed=true});await Promise.resolve();expect(closed).toBe(false);release({rows:[row],rowsAffected:1,lastInsertId:undefined});await work;await closing;expect(state.close).not.toHaveBeenCalled()
  const failure=new Error('private binding failure');state.database.execute=async()=>{throw failure};await expect(state.store.consume(request)).rejects.toBe(failure)
})
it('requires a matching atomic batch provider and validates requests before SQL',async()=>{
  for(const value of [{dialect:'postgres'},{dialect:'sqlite',execute:()=>{}},{dialect:'sqlite',batch:()=>{}}])expect(()=>new BatchSqliteRateLimitStore(value as unknown as BatchDatabase)).toThrow(RateLimitError)
  const state=fixture();await expect(state.store.consume({...request,key:'raw'})).rejects.toMatchObject({code:'INPUT'});expect(state.execute).not.toHaveBeenCalled()
})
