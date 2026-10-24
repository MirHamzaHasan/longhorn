import {createD1} from '../../runtimes/workers/dist/d1.js'
import {migrateSqliteBatch,verifySqliteBatchMigrations} from '../../packages/database/dist/batch.js'
const check=(value,label)=>{if(!value)throw new Error('Native D1 assertion: '+label)}
async function rejects(work,code){let failure;try{await work()}catch(error){failure=error}check(failure&&(!code||failure.code===code||failure.operation===code),'expected '+code);return failure}
const base=[{id:'native/001',statements:['CREATE TABLE samples(id INTEGER PRIMARY KEY,value TEXT,flag INTEGER,body BLOB)']}]
let boot
export default{async fetch(request,env){
  boot??=crypto.randomUUID()
  const path=new URL(request.url).pathname
  if(path==='/sql'){
    const{sql,args=[],database}=await request.json();return Response.json(await(database==='tasks'?env.TASKS:env.DB).prepare(sql).bind(...args).all())
  }
  const db=createD1(env.DB)
  try{
    if(path==='/state')return Response.json({boot,samples:(await db.execute('SELECT CAST(id AS TEXT) AS id,value,flag,body FROM samples ORDER BY id')).rows})
    if(path==='/provider'){
      await migrateSqliteBatch(db,base)
      const body=new Uint8Array([1,2,3]),input={sql:'INSERT INTO samples(id,value,flag,body) VALUES(?,?,?,?) RETURNING *',args:[1n,'original',true,body]}
      const pending=db.execute(input);input.args[1]='changed';body[0]=99;const inserted=await pending
      check(inserted.rows[0].value==='original'&&inserted.rows[0].flag===1&&inserted.rows[0].body[0]===1,'input snapshots/bool/blob')
      check(inserted.rowsAffected===1&&inserted.lastInsertId===1n,'native metadata')
      check((await db.execute('SELECT * FROM samples')).rowsAffected===0,'select changes')
      await rejects(()=>db.batch(["INSERT INTO samples(id,value) VALUES(2,'rollback')","INSERT INTO samples(id,value) VALUES(1,'duplicate')"]),'storage')
      check(!(await db.execute('SELECT id FROM samples WHERE id=2')).rows.length,'batch constraint rollback')
      await rejects(()=>db.execute('SELECT 9223372036854775807 AS unsafe'),'precision')
      await rejects(()=>db.execute("INSERT INTO samples(id,value) VALUES(3,'committed-before-decode') RETURNING 9007199254740992 AS unsafe"),'precision')
      check((await db.execute('SELECT value FROM samples WHERE id=3')).rows[0].value==='committed-before-decode','result conversion cannot roll back native commit')
      const wide=await db.execute("INSERT INTO samples(id,value) VALUES(9007199254740993,'exact text') RETURNING CAST(id AS TEXT) AS id")
      check(wide.rows[0].id==='9007199254740993'&&wide.lastInsertId===undefined,'explicit int64 text and omitted lossy rowid')
      await rejects(()=>db.execute('SELECT 1; DELETE FROM samples'),'input');await rejects(()=>db.execute('/*prefix*/ BEGIN'),'input')
      await rejects(()=>db.execute({sql:'SELECT ?',args:[9007199254740993n]}),'input')
      await db.execute('CREATE TRIGGER sample_trigger AFTER INSERT ON samples WHEN NEW.id=4 BEGIN UPDATE samples SET value=CASE WHEN NEW.flag=1 THEN \'triggered\' ELSE \'other\' END WHERE id=NEW.id; END;')
      await db.execute("INSERT INTO samples(id,value,flag) VALUES(4,'before',1)")
      check((await db.execute('SELECT value FROM samples WHERE id=4')).rows[0].value==='triggered','single trigger with internal delimiters')
      return Response.json({verified:true,stats:db.stats()})
    }
    if(path==='/migrations'){
      await migrateSqliteBatch(db,base)
      const failed=[...base,{id:'native/002',statements:['ALTER TABLE samples ADD COLUMN upgrade_marker TEXT','CREATE TABLE samples(duplicate INTEGER)']}]
      await rejects(()=>migrateSqliteBatch(db,failed),'apply')
      check(!(await db.execute('PRAGMA table_info(samples)')).rows.some(row=>row.name==='upgrade_marker'),'DDL rolled back with history')
      await verifySqliteBatchMigrations(db,base)
      await rejects(()=>migrateSqliteBatch(db,[{id:'native/001',statements:['CREATE TABLE changed(id INTEGER)']}]),'history')
      const full=[...base,{id:'native/002',statements:['ALTER TABLE samples ADD COLUMN upgrade_marker TEXT',"INSERT INTO samples(id,value) VALUES(5,'one upgrade')"]}]
      let waiting=0,release;const gate=new Promise(resolve=>{release=resolve})
      const wrapper={dialect:'sqlite',execute:statement=>db.execute(statement),close:async()=>{},batch:async statements=>{
        if(typeof statements[0]==='object'&&statements[0].sql.startsWith('INSERT INTO longhorn_batch_migration_guard')){waiting++;if(waiting===2)release();await gate}
        return db.batch(statements)
      }}
      const attempts=await Promise.allSettled([migrateSqliteBatch(wrapper,full),migrateSqliteBatch(wrapper,full)])
      check(attempts.filter(value=>value.status==='fulfilled').length===1&&attempts.filter(value=>value.status==='rejected').length===1,'competing prefix guard')
      check((await db.execute("SELECT COUNT(*) AS total FROM samples WHERE value='one upgrade'")).rows[0].total===1,'upgrade applies once')
      check((await migrateSqliteBatch(db,full)).length===0,'explicit safe rerun')
      await verifySqliteBatchMigrations(db,full)
      return Response.json({verified:true})
    }
    if(path==='/drain'){
      let release,entered=false;const gate=new Promise(resolve=>{release=resolve})
      const wrapped={prepare:env.DB.prepare.bind(env.DB),batch:async statements=>{const result=await env.DB.batch(statements);entered=true;await gate;return result}}
      const owned=createD1(wrapped,{maxPending:1}),write=owned.execute("INSERT INTO samples(id,value) VALUES(6,'drained')")
      let failure;write.catch(error=>{failure=error;entered=true})
      try{
        while(!entered)await new Promise(resolve=>setTimeout(resolve,0))
        if(failure)throw failure
        await rejects(()=>owned.execute('SELECT 1'),'capacity');const closing=owned.close();check(owned.close()===closing,'memoized close')
        await rejects(()=>owned.execute('SELECT 1'),'closed');check(!owned.stats().closed,'actual accepted binding work remains owned')
        check((await db.execute('SELECT value FROM samples WHERE id=6')).rows[0].value==='drained','commit exists before held acknowledgement')
        release();await write;await closing;check(owned.stats().closed,'final native drain')
      }finally{release();await owned.close()}
      return Response.json({verified:true})
    }
    return Response.json({error:'Unknown fixture route'},{status:404})
  }catch(error){return Response.json({error:'Native D1 contract failed',code:error.code??error.operation??'assertion',detail:typeof error.message==='string'&&error.message.startsWith('Native D1 assertion: ')?error.message:undefined},{status:500})}
  finally{await db.close()}
}}
