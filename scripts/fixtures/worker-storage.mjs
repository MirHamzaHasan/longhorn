import { createDurableSqlite } from '../../runtimes/workers/dist/durable-sqlite.js'
import { migrate } from '../../packages/database/dist/index.js'
import { SqliteQueueStore, queueMigrations } from '../../packages/queue/dist/sqlite.js'
import { SqliteSchedulerStore, schedulerMigrations } from '../../packages/scheduler/dist/sqlite.js'
import { Queue } from '../../packages/queue/dist/index.js'
import { Scheduler } from '../../packages/scheduler/dist/index.js'

const check=(value,label) => { if (!value) throw new Error('Native storage assertion: '+label) }
async function rejects(work,label) { let failed=false;try { await work() } catch { failed=true } check(failed,label) }
const schema={ '~standard': { version: 1,vendor: 'native-fixture',validate: value => ({ value }) } }
const migrations=[...queueMigrations,...schedulerMigrations,{ id:'fixture/001',statements:['CREATE TABLE samples (id INTEGER PRIMARY KEY,value TEXT,flag INTEGER,blob BLOB) STRICT'] }]

export class StorageFixture {
  constructor(state,env) {
    this.state=state;this.env=env;this.boot=crypto.randomUUID();this.database=createDurableSqlite(state)
    this.ready=migrate(this.database,migrations)
  }
  async fetch(request) {
    await this.ready
    const path=new URL(request.url).pathname,db=this.database
    if (path==='/provider') {
      for (const maxPending of [0,1.5,1025]) { let failed=false;try { createDurableSqlite(this.state,{ maxPending }) } catch { failed=true } check(failed,'capacity validation') }
      const bytes=new Uint8Array([1,2,3]),input={ sql:'INSERT INTO samples(id,value,flag,blob) VALUES(?,?,?,?) RETURNING *',args:[1n,'bound',true,bytes] }
      const pending=db.execute(input);bytes[0]=9;input.args[1]='changed'
      const inserted=await pending
      check(inserted.rowsAffected===1&&inserted.lastInsertId===1n,'insert metadata')
      check(inserted.rows[0].value==='bound'&&inserted.rows[0].flag===1&&inserted.rows[0].blob[0]===1,'snapshot/bool/blob')
      check((await db.execute('SELECT * FROM samples')).rowsAffected===0,'select affected rows')
      const scalar=(await db.execute({sql:'SELECT ? AS fraction, ? AS missing, ? AS minimum',args:[-42.5,null,BigInt(Number.MIN_SAFE_INTEGER)]})).rows[0]
      check(scalar.fraction===-42.5&&scalar.missing===null&&scalar.minimum===Number.MIN_SAFE_INTEGER,'finite/null/safe integer values')
      await rejects(() => db.execute({sql:'SELECT ?',args:[9007199254740993n]}),'unsafe bigint bind')
      await rejects(() => db.execute({sql:'SELECT ?',args:[Infinity]}),'non-finite bind')
      await rejects(() => db.execute('SELECT 9007199254740992 AS unsafe'),'unsafe result')
      await rejects(() => db.execute("INSERT INTO samples(id,value) VALUES(2,'must rollback') RETURNING 9007199254740992 AS unsafe"),'conversion rollback')
      check((await db.execute('SELECT * FROM samples WHERE id=2')).rows.length===0,'conversion failure rolled back effect')
      const wide=await db.execute("INSERT INTO samples(id,value) VALUES(9007199254740993,'wide rowid')")
      check(wide.lastInsertId===9007199254740993n,'exact int64 rowid metadata via SQL text')
      check((await db.execute('SELECT CAST(id AS TEXT) AS id FROM samples WHERE id=9007199254740993')).rows[0].id==='9007199254740993','explicit exact integer text')
      await rejects(() => db.execute('SELECT id FROM samples WHERE id=9007199254740993'),'wide ordinary row rejects lossy number')
      await db.execute('DELETE FROM samples WHERE id=9007199254740993')
      const original={domain:'rollback'};let retained
      try { await db.transaction(async tx => { retained=tx;await tx.execute("INSERT INTO samples(id,value) VALUES(3,'rollback')");throw original }) }
      catch (error) { check(error===original,'original error identity') }
      await rejects(() => retained.execute('SELECT 1'),'expired failed executor')
      check((await db.execute('SELECT * FROM samples WHERE id=3')).rows.length===0,'callback rollback')
      const second=createDurableSqlite(this.state)
      check(await db.transaction(async tx => {
        retained=tx;await rejects(() => db.execute('SELECT 1'),'root reentrancy')
        await rejects(() => second.execute('SELECT 1'),'other handle reentrancy')
        await tx.execute("INSERT INTO samples(id,value) VALUES(4,'committed')");return 42
      })===42,'transaction return')
      await rejects(() => retained.execute('SELECT 1'),'expired successful executor')
      await rejects(() => db.execute('BEGIN TRANSACTION'),'manual SQL transaction')
      await rejects(() => db.execute('not valid SQL'),'ordinary SQL failure')
      await rejects(() => migrate(db,[...migrations,{id:'fixture/002_bad',statements:['CREATE TABLE must_rollback(id INTEGER)','not valid SQL']}]),'failed migration')
      check((await db.execute("SELECT name FROM sqlite_master WHERE name='must_rollback'")).rows.length===0,'DDL migration rollback')
      check((await db.execute('SELECT id FROM longhorn_migrations')).rows.length===migrations.length,'history rollback')
      await rejects(() => migrate(db,[...migrations.slice(0,-1),{id:'fixture/001',statements:['SELECT 1']}]),'changed migration checksum')
      await rejects(() => migrate(db,[...migrations].reverse()),'reordered history')
      const small=createDurableSqlite(this.state,{maxPending:1}),one=small.execute('SELECT 1')
      await rejects(() => small.execute('SELECT 2'),'bounded pending admission');await one
      const closing=small.close();check(closing===small.close(),'memoized handle close');await closing
      await rejects(() => small.execute('SELECT 1'),'closed handle')
      check((await db.execute('SELECT * FROM samples')).rows.length===2,'borrowed binding remains open')
      await second.close()
      return Response.json({ok:true,boot:this.boot})
    }
    if (path==='/claims') {
      const store=new SqliteQueueStore(db)
      for (const id of ['a','b','c']) await store.enqueue({queue:'claims',id,payload:'{}',maxAttempts:3,availableAt:0,now:0})
      const claims=await Promise.all(['one','two','three'].map(token => store.claim({queue:'claims',token,now:0,leaseMs:10})))
      check(new Set(claims.map(job=>job.id)).size===3,'distinct concurrent claims')
      const first=claims[0],ownership={queue:'claims',id:first.id,token:first.leaseToken,now:1}
      check(!await store.complete({...ownership,token:'wrong'}),'wrong owner fenced')
      check(await store.renew({...ownership,leaseMs:20}),'renew current owner')
      check(await store.complete({...ownership,now:20}),'renewed owner completes')
      const recovered=await store.claim({queue:'claims',token:'recovered',now:10,leaseMs:10})
      check(recovered.attempts===2&&recovered.leaseToken==='recovered','expiry recovery')
      const stale=claims.find(job=>job.id===recovered.id)
      check(!await store.complete({queue:'claims',id:stale.id,token:stale.leaseToken,now:11}),'stale owner fenced')
      check(await store.fail({queue:'claims',id:recovered.id,token:'recovered',now:11,retryAt:30,reason:'handler'}),'retry persisted')
      const retry=await store.get('claims',recovered.id)
      check(retry.state==='pending'&&retry.availableAt===30&&retry.lastFailure==='handler','stored retry metadata')
      return Response.json({ok:true})
    }
    if (path==='/dispatch' || path==='/prepare-abort') {
      const queue=new Queue({name:'scheduled',schema,store:new SqliteQueueStore(db)}),scheduler=new Scheduler({store:new SqliteSchedulerStore(db)})
      try {
        const id=path==='/dispatch'?'atomic':'interrupted'
        await scheduler.at(queue,{numbers:[2,4,6]},{id,at:0})
        if (path==='/prepare-abort') return Response.json({ok:true})
        const fault={...db,transaction:work=>db.transaction(tx=>work({...tx,execute:async statement=>{
          if (typeof statement!=='string'&&statement.sql.startsWith('UPDATE longhorn_schedules')) throw new Error('injected after occurrence insertion')
          return tx.execute(statement)
        }}))}
        await rejects(()=>new SqliteSchedulerStore(fault).dispatch({now:0,limit:1}),'dispatch error')
        check((await db.execute("SELECT * FROM longhorn_queue_jobs WHERE id='scheduled:atomic:0'")).rows.length===0,'occurrence rollback')
        check((await scheduler.get(id)).dispatchCount===0,'cursor rollback')
        const ticks=await Promise.all([new SqliteSchedulerStore(db).dispatch({now:0,limit:1}),new SqliteSchedulerStore(db).dispatch({now:0,limit:1})])
        check(ticks.reduce((count,tick)=>count+tick.dispatched.length,0)===1,'one atomic occurrence across dispatchers')
        await scheduler.at(queue,{numbers:[1]},{id:'cancelled',at:0});check(await scheduler.cancel('cancelled'),'cancel active')
        check((await scheduler.tick({limit:10})).dispatched.length===0,'cancel prevents dispatch')
        return Response.json({ok:true})
      } finally {await scheduler.close();await queue.close()}
    }
    if (path==='/abort-dispatch') {
      const interrupted={...db,transaction:work=>db.transaction(tx=>work({...tx,execute:async statement=>{
        if (typeof statement!=='string'&&statement.sql.startsWith('UPDATE longhorn_schedules')) this.state.abort('owned storage interruption fixture')
        return tx.execute(statement)
      }}))}
      await new SqliteSchedulerStore(interrupted).dispatch({now:0,limit:1})
      throw new Error('Object abort did not terminate dispatch')
    }
    if (path==='/drain') {
      const local=createDurableSqlite(this.state)
      let entered;const started=new Promise(resolve=>{entered=resolve})
      const work=local.transaction(async tx=>{
        await tx.execute("INSERT INTO samples(id,value) VALUES(5,'drained')")
        entered()
        await fetch(this.env.GATE_URL)
        await tx.execute("UPDATE samples SET value='completed before close' WHERE id=5")
      })
      await started
      const closing=local.close();await rejects(()=>local.execute('SELECT 1'),'close stops admission')
      await work;await closing
      check((await db.execute('SELECT value FROM samples WHERE id=5')).rows[0].value==='completed before close','accepted work drains before close')
      return Response.json({ok:true})
    }
    if (path==='/state') return Response.json({boot:this.boot,
      samples:(await db.execute('SELECT id,value FROM samples ORDER BY id')).rows,
      schedules:(await db.execute('SELECT id,state,dispatch_count,next_at FROM longhorn_schedules ORDER BY id')).rows,
      jobs:(await db.execute('SELECT id,state,attempts,available_at FROM longhorn_queue_jobs ORDER BY id')).rows,
    })
    return new Response('missing',{status:404})
  }
}
export default { fetch(request,env) { return env.STORE.get(env.STORE.idFromName('native')).fetch(request) } }
