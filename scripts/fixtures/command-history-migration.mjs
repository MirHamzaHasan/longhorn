import { createInterface } from 'node:readline'
import { openPostgres } from '../../runtimes/node/dist/postgres.js'
import { migratePostgres } from '../../packages/database/dist/postgres.js'
import { postgresOperationsMigrations } from '../../examples/postgres/dist/operations-migrations.js'
const database=await openPostgres({connectionString:process.env.HISTORY_OWNER_URL,maxConnections:1})
const lines=createInterface({input:process.stdin}),iterator=lines[Symbol.asyncIterator]()
if(process.env.HISTORY_HOLD_COMMIT==='true'){
  const transaction=database.transaction.bind(database)
  database.transaction=work=>transaction(async tx=>{const value=await work(tx);console.log(JSON.stringify({stage:'before-commit'}));await iterator.next();return value})
}
try{
  const added=await migratePostgres(database,postgresOperationsMigrations,{schema:'longhorn_pg_example'})
  console.log(JSON.stringify({stage:'migrated',added}))
}finally{lines.close();await database.close()}
