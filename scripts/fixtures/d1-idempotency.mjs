import{createD1}from'../../runtimes/workers/dist/d1.js'
import{BatchIdempotency,batchIdempotencyMigrations}from'../../packages/idempotency/dist/batch-sqlite.js'
import{migrateSqliteBatch}from'../../packages/database/dist/batch.js'
import{migrations as taskMigrations}from'../../examples/d1-worker/src/schema.ts'
const check=(value,label)=>{if(!value)throw new Error('D1 idempotency assertion: '+label)}
async function rejects(work,code){let error;try{await work()}catch(value){error=value}check(error&&(error.code===code||(code==='conflict'&&error.name==='IdempotencyConflictError')),'expected '+code);return error}
const request=(key,input={value:1},scope='native:create:v1')=>({scope,key,input})
const plan=(id,tail=[])=>({result:{id},statements:[{sql:'INSERT INTO effects(id) VALUES(?)',args:[id]},...tail]})
export default{async fetch(message,env){
  const path=new URL(message.url).pathname,db=createD1(path==='/contract'?env.DB:env.TASKS)
  try{
    if(path==='/sql'){const{sql,args=[]}=await message.json(),result=await db.execute({sql,args});return Response.json({rows:result.rows,rowsAffected:result.rowsAffected})}
    if(path==='/legacy'){
      await migrateSqliteBatch(db,taskMigrations.slice(0,2))
      const id=crypto.randomUUID(),mutation=crypto.randomUUID(),at=new Date().toISOString()
      await db.batch([
        {sql:'INSERT INTO d1_tasks(id,title,completed,revision,created_at,updated_at,mutation) VALUES(?,?,0,1,?,?,?)',args:[id,'legacy retained task',at,at,mutation]},
        {sql:"INSERT INTO d1_task_activity(task_id,revision,kind,at,mutation) VALUES(?,1,'created',?,?)",args:[id,at,mutation]},
      ])
      return Response.json({id})
    }
    if(path==='/contract'){
      await migrateSqliteBatch(db,[...batchIdempotencyMigrations,{id:'native/effects',statements:['CREATE TABLE effects(id TEXT PRIMARY KEY,body BLOB)']}])
      let at=1000
      const service=new BatchIdempotency({database:db,now:()=>at,retentionMs:10})
      const input={label:'original'},bytes=new Uint8Array([1,2]),mutable={result:{id:'snapshot'},statements:[{sql:'INSERT INTO effects(id,body) VALUES(?,?)',args:['snapshot',bytes]}]}
      const pending=service.run(request('snapshot',input),mutable)
      input.label='changed';mutable.result.id='changed';mutable.statements[0].args[0]='changed';bytes[0]=99
      check((await pending).value.id==='snapshot','response snapshot before hashing')
      check((await service.run(request('snapshot',{label:'original'}),plan('snapshot-must-not-run'))).replayed,'input snapshot before hashing')
      check((await db.execute("SELECT body FROM effects WHERE id='snapshot'")).rows[0].body[0]===1,'SQL argument/blob snapshot before hashing')
      const first=await service.run(request('canonical',{a:1,b:2}),plan('canonical'))
      const replay=await service.run(request('canonical',{b:2,a:1}),plan('must-not-run'))
      check(!first.replayed&&replay.replayed&&JSON.stringify(first.value)===JSON.stringify(replay.value)&&replay.expiresAt===1010,'canonical JSON and original expiry')
      await rejects(()=>service.run(request('canonical',{a:2,b:2}),plan('conflict')),'conflict')
      check(!(await db.execute("SELECT id FROM effects WHERE id IN('must-not-run','conflict')")).rows.length,'replays/conflicts skip business SQL')
      const failure=await rejects(()=>service.run(request('failed'),plan('rolled-back',["INSERT INTO effects(id) VALUES('canonical')"])),'storage')
      check(!String(failure).includes('canonical'),'sanitized failure')
      check(!(await db.execute("SELECT id FROM effects WHERE id='rolled-back'")).rows.length&&!(await db.execute("SELECT request_key FROM longhorn_batch_idempotency_requests WHERE request_key='failed'")).rows.length,'business and ledger rollback')
      check(!(await service.run(request('failed'),plan('retried-after-rollback'))).replayed,'explicit retry after rollback')
      const decoded=await service.run(request('decoder'),plan('decoder-committed',["SELECT 9007199254740992 AS unsafe"]))
      check(!decoded.replayed&&decoded.value.id==='decoder-committed','positive recovery after native post-commit decoder failure')
      let calls=0
      const borrowed=createD1({prepare:env.DB.prepare.bind(env.DB),batch:async statements=>{calls++;const value=await env.DB.batch(statements);if(calls===1)throw new Error('private lost acknowledgement');return value}})
      try{
        const recovered=await new BatchIdempotency({database:borrowed,now:()=>at,retentionMs:10}).run(request('lost'),plan('lost-ack-committed'))
        check(!recovered.replayed&&recovered.value.id==='lost-ack-committed'&&calls===2,'one mutation batch and one positive recovery read')
      }finally{await borrowed.close()}
      await service.run(request('generation',{version:1}),plan('generation-1'));at=1010
      await rejects(()=>service.run(request('generation',{version:2}),plan('failed-generation',["INSERT INTO effects(id) VALUES('canonical')"])),'storage')
      const old=(await db.execute("SELECT result,expires_at FROM longhorn_batch_idempotency_requests WHERE request_key='generation'")).rows[0]
      check(JSON.parse(old.result).id==='generation-1'&&old.expires_at===1010,'failed expiry replacement restores old ledger')
      const second=createD1(env.DB),other=new BatchIdempotency({database:second,now:()=>at,retentionMs:10})
      try{
        const replacements=await Promise.all([service.run(request('generation',{version:2}),plan('generation-2')),other.run(request('generation',{version:2}),plan('generation-3'))])
        check(replacements.filter(value=>!value.replayed).length===1&&replacements[0].value.id===replacements[1].value.id,'one winner replacing expired generation')
        check((await db.execute("SELECT id FROM effects WHERE id IN('generation-2','generation-3')")).rows.length===1,'one replacement effect')
      }finally{await second.close()}
      await service.run(request('canonical',{a:2},'other:scope'),plan('other-scope'))
      at=100000
      await new BatchIdempotency({database:db,now:()=>at,retentionMs:1000000}).run(request('live'),plan('live'))
      const before=(await db.execute('SELECT COUNT(*) AS count FROM effects')).rows[0].count
      check(await service.prune(2)===2,'bounded cleanup')
      while(await service.prune(2)){}
      check((await db.execute('SELECT request_key FROM longhorn_batch_idempotency_requests')).rows[0].request_key==='live','unexpired result survives cleanup')
      check((await db.execute('SELECT COUNT(*) AS count FROM effects')).rows[0].count===before,'cleanup leaves business effects')
      return Response.json({verified:true})
    }
    return Response.json({error:'Unknown private fixture route'},{status:404})
  }catch(error){return Response.json({error:'Native D1 idempotency verification failed',code:error.code??error.operation??error.name,detail:error.message?.startsWith('D1 idempotency assertion: ')?error.message:undefined},{status:500})}
  finally{await db.close()}
}}
