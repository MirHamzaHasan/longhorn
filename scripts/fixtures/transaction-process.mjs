import { createInterface } from 'node:readline'
import { openSqlite } from '../../runtimes/node/dist/sqlite.js'
import { openPostgres } from '../../runtimes/node/dist/postgres.js'
import { Queue } from '../../packages/queue/dist/index.js'
import { SqliteQueueStore } from '../../packages/queue/dist/sqlite.js'
import { PostgresQueueStore } from '../../packages/queue/dist/postgres.js'
import { enqueueInTransaction } from '../../packages/queue/dist/transaction.js'

const postgres=process.env.LONGHORN_TRANSACTION_PROVIDER==='postgres'
const database=postgres?await openPostgres({connectionString:process.env.LONGHORN_TRANSACTION_URL,maxConnections:1}):await openSqlite({filename:process.env.LONGHORN_TRANSACTION_FILE})
const schema={'~standard':{version:1,vendor:'native-transaction',validate:value=>({value})}}
const queue=new Queue({name:'atomic.transaction.v1',schema,store:postgres?new PostgresQueueStore(database):new SqliteQueueStore(database)})
const lines=createInterface({input:process.stdin}),iterator=lines[Symbol.asyncIterator]()
const print=value=>process.stdout.write(JSON.stringify(value)+'\n')
try{
  const result=await database.transaction(async tx=>{
    const statement=postgres?{sql:'INSERT INTO longhorn_pg_example.tasks(title) VALUES($1) RETURNING id',args:[process.env.LONGHORN_TRANSACTION_TITLE]}:
      {sql:'INSERT INTO atomic_business(title) VALUES(?) RETURNING id',args:[process.env.LONGHORN_TRANSACTION_TITLE]}
    const id=String((await tx.execute(statement)).rows[0].id)
    const job=await enqueueInTransaction(queue,tx,{businessId:id})
    print({stage:'before-commit',businessId:id,jobId:job.id})
    await iterator.next()
    return{businessId:id,jobId:job.id}
  })
  print({stage:'committed',...result})
  if(process.env.LONGHORN_TRANSACTION_HOLD_AFTER==='true')await iterator.next()
}finally{lines.close();await queue.close();await database.close()}
