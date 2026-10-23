import { createInterface } from 'node:readline'
import { openSqlite } from '../../runtimes/node/dist/sqlite.js'
import { openPostgres } from '../../runtimes/node/dist/postgres.js'
import { Idempotency } from '../../packages/idempotency/dist/index.js'
import { SqliteIdempotencyStore } from '../../packages/idempotency/dist/sqlite.js'
import { PostgresIdempotencyStore } from '../../packages/idempotency/dist/postgres.js'
import { Queue } from '../../packages/queue/dist/index.js'
import { SqliteQueueStore } from '../../packages/queue/dist/sqlite.js'
import { PostgresQueueStore } from '../../packages/queue/dist/postgres.js'
import { enqueueInTransaction } from '../../packages/queue/dist/transaction.js'

const pg=process.env.LONGHORN_IDEMPOTENCY_PROVIDER==='postgres',mode=process.env.LONGHORN_IDEMPOTENCY_MODE
const database=pg?await openPostgres({connectionString:process.env.LONGHORN_IDEMPOTENCY_URL,maxConnections:1}):await openSqlite({filename:process.env.LONGHORN_IDEMPOTENCY_FILE})
const schema={'~standard':{version:1,vendor:'native-idempotency',validate:value=>({value})}}
const queue=new Queue({name:'idempotent.native.v1',schema,store:pg?new PostgresQueueStore(database):new SqliteQueueStore(database)})
const service=new Idempotency({store:pg?new PostgresIdempotencyStore(database):new SqliteIdempotencyStore(database)})
const lines=createInterface({input:process.stdin}),iterator=lines[Symbol.asyncIterator](),print=value=>process.stdout.write(JSON.stringify(value)+'\n')
try{
  print({stage:'started'})
  const result=await service.run({scope:'native:tasks:v1',key:process.env.LONGHORN_IDEMPOTENCY_KEY,input:{title:'saved'}},async tx=>{
    const row=(await tx.execute(pg?{sql:'INSERT INTO longhorn_pg_example.tasks(title) VALUES($1) RETURNING id',args:['idempotent native']}:
      {sql:'INSERT INTO idempotent_business(title) VALUES(?) RETURNING id',args:['idempotent native']})).rows[0]
    const id=String(row.id),job=await enqueueInTransaction(queue,tx,{id})
    print({stage:'before-commit',id,jobId:job.id})
    if(mode==='pause-before')await iterator.next()
    return{id,job}
  })
  print({stage:'committed',...result})
  if(mode==='pause-after')await iterator.next()
}finally{lines.close();await queue.close();await database.close()}
