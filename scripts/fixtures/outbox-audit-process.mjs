import { createInterface } from 'node:readline'
import { openSqlite } from '../../runtimes/node/dist/sqlite.js'
import { openPostgres } from '../../runtimes/node/dist/postgres.js'
import { Outbox } from '../../packages/outbox/dist/index.js'
import { SqliteOutboxStore } from '../../packages/outbox/dist/sqlite.js'
import { PostgresOutboxStore } from '../../packages/outbox/dist/postgres.js'
const pg=process.env.LONGHORN_AUDIT_PROVIDER==='postgres',mode=process.env.LONGHORN_AUDIT_MODE
const database=pg?await openPostgres({connectionString:process.env.LONGHORN_AUDIT_URL,maxConnections:1}):await openSqlite({filename:process.env.LONGHORN_AUDIT_FILE})
const schema={'~standard':{version:1,vendor:'audit-process',validate:value=>({value})}}
const outgoing=new Outbox({name:process.env.LONGHORN_AUDIT_NAME,schema,store:pg?new PostgresOutboxStore(database):new SqliteOutboxStore(database)})
const lines=createInterface({input:process.stdin}),iterator=lines[Symbol.asyncIterator](),print=value=>process.stdout.write(JSON.stringify(value)+'\n')
try{
  print({stage:'ready'});await iterator.next()
  if(mode==='before-commit'){
    const transaction=database.transaction.bind(database)
    database.transaction=work=>transaction(async tx=>{const value=await work(tx);print({stage:'before-commit'});await iterator.next();return value})
  }
  const result=await outgoing.retryFailedAudited(process.env.LONGHORN_AUDIT_ID,{actor:'operator:process',reason:'provider-restored',expectedMaxAttempts:1,additionalAttempts:1})
  print({stage:'result',value:result})
  if(mode==='after-commit')await iterator.next()
}finally{lines.close();await outgoing.close();await database.close()}
