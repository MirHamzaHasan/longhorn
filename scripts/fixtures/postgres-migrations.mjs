import {openPostgres} from '../../runtimes/node/dist/postgres.js'
import {migratePostgres} from '../../packages/database/dist/postgres.js'
if(process.env.LONGHORN_PG_TEST_OWNED !== 'true') throw new Error('Owned QA cluster required')
const crash=process.argv[2]==='crash', schema=crash||process.argv[2]==='recover'?'crash_migration_qa':'process_migration_qa'
const database=await openPostgres({connectionString:process.env.LONGHORN_PG_TEST_URL})
let connection=database
if(crash) connection={...database,transaction:work=>database.transaction(tx=>work({dialect:'postgres',execute:async input=>{
  const sql=typeof input==='string'?input:input.sql
  if(sql.startsWith('INSERT INTO "'+schema+'".longhorn_migrations')){
    console.log(JSON.stringify({paused:true}))
    await new Promise(()=>{setInterval(()=>{},1000)})
  }
  return tx.execute(input)
}}))}
try{
 const added=await migratePostgres(connection,[{id:'initial',statements:['CREATE TABLE '+schema+'.items(id bigint PRIMARY KEY)','INSERT INTO '+schema+'.items VALUES(1)']}],{schema})
 console.log(JSON.stringify({added}))
}finally{await database.close()}
