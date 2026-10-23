import { createInterface } from 'node:readline'
import { openSqlite } from '../../runtimes/node/dist/sqlite.js'
import { openPostgres } from '../../runtimes/node/dist/postgres.js'
import { Outbox } from '../../packages/outbox/dist/index.js'
import { SqliteOutboxStore } from '../../packages/outbox/dist/sqlite.js'
import { PostgresOutboxStore } from '../../packages/outbox/dist/postgres.js'
const pg=process.env.LONGHORN_OUTBOX_PROVIDER==='postgres',mode=process.env.LONGHORN_OUTBOX_MODE
const database=pg?await openPostgres({connectionString:process.env.LONGHORN_OUTBOX_URL,maxConnections:1}):await openSqlite({filename:process.env.LONGHORN_OUTBOX_FILE})
const schema={'~standard':{version:1,vendor:'outbox-process',validate:value=>({value})}}
const outbox=new Outbox({name:process.env.LONGHORN_OUTBOX_NAME,schema,store:pg?new PostgresOutboxStore(database):new SqliteOutboxStore(database),leaseMs:500,retryDelayMs:10})
const lines=createInterface({input:process.stdin}),iterator=lines[Symbol.asyncIterator](),print=value=>process.stdout.write(JSON.stringify(value)+'\n')
try{
  if(mode==='producer'){
    const result=await database.transaction(async tx=>{
      const row=(await tx.execute(pg?{sql:'INSERT INTO longhorn_pg_example.tasks(title) VALUES($1) RETURNING id',args:['outgoing business']}:
        {sql:'INSERT INTO outbox_business(title) VALUES(?) RETURNING id',args:['outgoing business']})).rows[0]
      const id=String(row.id),delivery=await outbox.enqueueInTransaction(tx,{businessId:id})
      print({stage:'before-commit',id,delivery});await iterator.next();return{id,delivery}
    });print({stage:'committed',...result})
  }else{
    const result=await outbox.dispatchOnce({async publish(message,context){
      print({stage:'claimed',message,attempt:context.attempt})
      if(mode==='before-send')await iterator.next()
      const response=await fetch(process.env.LONGHORN_OUTBOX_BROKER+'/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message),signal:context.signal})
      if(!response.ok){print({stage:'refused',status:response.status});throw new Error('Native broker refused publish')};await response.text();print({stage:'accepted',id:message.id})
      if(mode==='after-send')await iterator.next()
    }},{heartbeat:false});print({stage:'done',result})
  }
}finally{lines.close();await outbox.close();await database.close()}
