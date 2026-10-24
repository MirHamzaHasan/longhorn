import assert from 'node:assert/strict'
import { SqliteAuthStore,authMigrations } from '../../packages/auth/dist/sqlite.js'
import { PostgresAuthStore } from '../../packages/auth/dist/postgres.js'
import { migrate } from '../../packages/database/dist/index.js'
export async function verifyNativeSessionControl({runtime,mode,filename,openSqlite,openDatabase}) {
const database=await openDatabase()
let second
try{
  if(runtime!=='pg')await migrate(database,authMigrations)
  let armed=false
  const borrowed={dialect:database.dialect,execute:database.execute.bind(database),close:async()=>{},transaction:work=>database.transaction(async tx=>{
    let deleted=false
    const result=await work({execute:async input=>{const result=await tx.execute(input),sql=typeof input==='string'?input:input.sql;if(sql.startsWith('DELETE FROM longhorn_auth'))deleted=true;return result}})
    if(armed&&deleted){console.log(JSON.stringify({message:'Session control transaction before commit',runtime}));setInterval(()=>{},1000);await new Promise(()=>{})}
    return result
  })}
  const store=runtime==='pg'?new PostgresAuthStore(borrowed):new SqliteAuthStore(borrowed)
  const prefix='control.'+runtime
  for(const name of[prefix,prefix+'.peer'])await store.createUser({id:name,username:name,roles:['member'],passwordHash:'fixture:unchanged'})
  const current='a'.repeat(64),other='b'.repeat(64),peer='c'.repeat(64),expired='d'.repeat(64)
  for(const[tokenHash,userId,expiresAt]of[[current,prefix,2000],[other,prefix,2000],[peer,prefix+'.peer',2000],[expired,prefix,1000]])await store.createSession({tokenHash,userId,expiresAt})
  if(mode==='crash'){armed=true;await store.sessionControls.revoke({tokenHash:current,scope:'all'},()=>1000);throw new Error('Crash barrier was not reached')}
  assert.equal(await store.sessionControls.revoke({tokenHash:current,scope:'others'},()=>1000),1)
  for(const hash of[current,peer,expired])assert.ok(await store.findSession(hash))
  assert.equal(await store.findSession(other),undefined)
  assert.equal(await store.sessionControls.revoke({tokenHash:current,scope:'others'},()=>1000),0)
  await store.createSession({tokenHash:other,userId:prefix,expiresAt:2000})
  if(runtime!=='pg'){
    await database.execute("CREATE TRIGGER reject_session_control BEFORE DELETE ON longhorn_auth_sessions BEGIN SELECT RAISE(ABORT,'fixture session rollback'); END")
    await assert.rejects(store.sessionControls.revoke({tokenHash:current,scope:'all'},()=>1000),error=>runtime==='node'?/fixture session rollback/.test(error.message):error.code==='storage')
    for(const hash of[current,other,peer])assert.ok(await store.findSession(hash))
    await database.execute('DROP TRIGGER reject_session_control')
    second=await openSqlite({filename});const secondStore=new SqliteAuthStore(second)
    let enter,release,samples=0,now=1000;const entered=new Promise(resolve=>{enter=resolve}),gate=new Promise(resolve=>{release=resolve})
    const holder=database.transaction(async()=>{enter();await gate});await entered
    const pending=secondStore.sessionControls.revoke({tokenHash:current,scope:'all'},()=>{samples++;return now})
    try{await Promise.resolve();assert.equal(samples,0);now=2000}finally{release();await holder}
    assert.equal(await pending,undefined);assert.equal(samples,1);assert.ok(await store.findSession(other))
  }
  assert.equal(await store.sessionControls.revoke({tokenHash:current,scope:'all'},()=>1000),2)
  assert.equal(await store.findSession(current),undefined);assert.equal(await store.findSession(other),undefined);assert.ok(await store.findSession(peer));assert.ok(await store.findSession(expired))
  assert.equal(await store.sessionControls.revoke({tokenHash:current,scope:'all'},()=>1000),undefined)
  assert.equal((await store.findUserByUsername(prefix)).passwordHash,'fixture:unchanged')
  console.log(JSON.stringify({message:'Native session controls verified',runtime}))
}finally{await second?.close();await database.close()}

}
