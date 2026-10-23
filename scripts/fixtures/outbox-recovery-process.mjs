import { createInterface } from 'node:readline'
import { openSqlite } from '../../runtimes/node/dist/sqlite.js'
import { openPostgres } from '../../runtimes/node/dist/postgres.js'
import { Outbox } from '../../packages/outbox/dist/index.js'
import { SqliteOutboxStore } from '../../packages/outbox/dist/sqlite.js'
import { PostgresOutboxStore } from '../../packages/outbox/dist/postgres.js'
const pg=process.env.LONGHORN_RECOVERY_PROVIDER==='postgres',mode=process.env.LONGHORN_RECOVERY_MODE
const database=pg?await openPostgres({connectionString:process.env.LONGHORN_RECOVERY_URL,maxConnections:1}):await openSqlite({filename:process.env.LONGHORN_RECOVERY_FILE})
const schema={'~standard':{version:1,vendor:'recovery-process',validate:value=>({value})}}
const outgoing=new Outbox({name:process.env.LONGHORN_RECOVERY_NAME,schema,store:pg?new PostgresOutboxStore(database):new SqliteOutboxStore(database)})
const lines=createInterface({input:process.stdin}),iterator=lines[Symbol.asyncIterator](),print=value=>process.stdout.write(JSON.stringify(value)+'\n')
try{
  print({stage:'ready'});await iterator.next()
  if(mode==='retry-before-commit'){
    // Test-only native transaction wrapper pauses the production conditional UPDATE before its outer commit.
    const execute=database.execute.bind(database)
    database.execute=input=>typeof input==='object'&&input.sql.includes("SET state='pending',max_attempts=")?database.transaction(async tx=>{
      const result=await tx.execute(input);print({stage:'before-commit'});await iterator.next();return result
    }):execute(input)
  }
  const result=mode==='prune'?await outgoing.prune({before:Date.now(),includeFailed:true,limit:1}):
    await outgoing.retryFailed(process.env.LONGHORN_RECOVERY_ID,{expectedMaxAttempts:Number(process.env.LONGHORN_RECOVERY_EXPECTED??1),additionalAttempts:1})
  print({stage:'result',result})
  if(mode==='retry-after-commit')await iterator.next()
}finally{lines.close();await outgoing.close();await database.close()}
