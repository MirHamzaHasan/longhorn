import { cleanupContract } from './cleanup-contract.mjs'
import assert from 'node:assert/strict'
import { Idempotency } from '../../packages/idempotency/dist/index.js'
import { IdempotencyCleanup } from '../../packages/idempotency/dist/cleanup.js'
import { SqliteIdempotencyStore,idempotencyMigrations } from '../../packages/idempotency/dist/sqlite.js'
import { migrate } from '../../packages/database/dist/index.js'

const runtime=globalThis.Deno?'deno':globalThis.Bun?'bun':'node'
const filename=globalThis.Deno?Deno.args[0]:process.argv[2]
const {openSqlite}=await import('../../runtimes/'+runtime+'/dist/sqlite.js')
const database=await openSqlite({filename})
let cleanup
try{
  await migrate(database,idempotencyMigrations)
  let clock=10,effects=0
  const store=new SqliteIdempotencyStore(database),short=new Idempotency({store,retentionMs:1,now:()=>clock}),long=new Idempotency({store,retentionMs:1000,now:()=>clock})
  const expired={scope:'cleanup:native',key:'expired',input:1},live={scope:'cleanup:native',key:'live',input:2}
  await short.run(expired,async()=>++effects);await long.run(live,async()=>++effects);clock=50
  cleanup=new IdempotencyCleanup(short,{limit:1,intervalMs:10});cleanup.start()
  const deadline=Date.now()+5000
  while(cleanup.snapshot().removed!==1){assert.ok(Date.now()<deadline,'Native SQLite cleanup timed out');await new Promise(done=>setTimeout(done,5))}
  await cleanup.close();assert.equal(cleanup.snapshot().errors,0)
  assert.equal((await long.run(live,async()=>++effects)).replayed,true);assert.equal(effects,2)
  assert.equal((await short.run(expired,async()=>++effects)).replayed,false);assert.equal(effects,3)
  console.log(JSON.stringify({runtime,sqlite:true,...await cleanupContract()}))
}finally{await cleanup?.close();await database.close()}
