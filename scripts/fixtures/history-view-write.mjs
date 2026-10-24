import { createInterface } from 'node:readline'
import { openPostgres } from '../../runtimes/node/dist/postgres.js'
import { AuthService } from '../../packages/auth/dist/index.js'
import { PostgresAuthStore } from '../../packages/auth/dist/postgres.js'
import { createScryptPasswordHasher } from '../../runtimes/node/dist/passwords.js'
import { Idempotency } from '../../packages/idempotency/dist/index.js'
import { PostgresIdempotencyStore } from '../../packages/idempotency/dist/postgres.js'
import { PostgresHistoryViews } from '../../examples/postgres/dist/history-views.js'
const db=await openPostgres({connectionString:process.env.HISTORY_VIEW_DATABASE_URL,maxConnections:1}),lines=createInterface({input:process.stdin}),iterator=lines[Symbol.asyncIterator](),transaction=db.transaction.bind(db)
db.transaction=work=>transaction(async tx=>{const result=await work(tx);console.log(JSON.stringify({stage:'before-commit'}));await iterator.next();return result})
try{
  const input=JSON.parse(process.env.HISTORY_VIEW_INPUT),owner=process.env.HISTORY_VIEW_OWNER,accounts=new AuthService(new PostgresAuthStore(db),createScryptPasswordHasher()),views=new PostgresHistoryViews(db),requests=new Idempotency({store:new PostgresIdempotencyStore(db)})
  await requests.run({scope:'user:'+owner+':history-view:create:v1',key:input.id,input},async tx=>{const current=await accounts.authenticateInTransaction(tx,process.env.HISTORY_VIEW_TOKEN);if(!current||current.user.id!==owner)throw new Error('Owned fixture authentication failed');return views.createIn(tx,owner,input.id,input.name,input.selection)})
  console.log(JSON.stringify({stage:'committed'}))
}finally{lines.close();await db.close()}
