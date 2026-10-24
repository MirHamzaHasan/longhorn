import { RateLimiter } from '../../packages/ratelimit/dist/index.js'
import { SqliteRateLimitStore } from '../../packages/ratelimit/dist/sqlite.js'
import { PostgresRateLimitStore } from '../../packages/ratelimit/dist/postgres.js'
import { openPostgres } from '../../runtimes/node/dist/postgres.js'
import { openSqlite } from '../../runtimes/node/dist/sqlite.js'
const pg=process.env.LIMIT_DRIVER==='postgres',mode=process.env.LIMIT_CHECKPOINT
const db=pg?await openPostgres({connectionString:process.env.LIMIT_DATABASE}):await openSqlite({filename:process.env.LIMIT_DATABASE})
const hold=()=>{console.log(JSON.stringify({checkpoint:mode}));setInterval(()=>{},1000);return new Promise(()=>{})}
const wrapped={dialect:db.dialect,execute:db.execute.bind(db),close:db.close.bind(db),transaction:work=>db.transaction(tx=>work({dialect:tx.dialect,execute:async statement=>{
  const result=await tx.execute(statement),sql=typeof statement==='string'?statement:statement.sql
  if(mode==='before'&&sql.startsWith('UPDATE longhorn_rate_limit'))await hold()
  return result
}}))}
try{
  const limiter=new RateLimiter({scope:'crash.'+mode,store:pg?new PostgresRateLimitStore(wrapped):new SqliteRateLimitStore(wrapped),limit:1,windowMs:86400000})
  await limiter.consume('crash subject');if(mode==='after')await hold();await limiter.close()
}finally{await db.close()}
