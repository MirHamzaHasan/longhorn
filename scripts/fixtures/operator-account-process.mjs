import { createInterface } from 'node:readline'
import { openPostgres } from '../../runtimes/node/dist/postgres.js'
import { AuthService } from '../../packages/auth/dist/index.js'
import { PostgresAuthStore } from '../../packages/auth/dist/postgres.js'
import { Outbox } from '../../packages/outbox/dist/index.js'
import { PostgresOutboxStore } from '../../packages/outbox/dist/postgres.js'

const mode=process.env.LONGHORN_OPERATOR_MODE
const database=await openPostgres({connectionString:process.env.LONGHORN_OPERATOR_URL,applicationName:process.env.LONGHORN_OPERATOR_TAG,maxConnections:1,lockTimeoutMs:15000})
const lines=createInterface({input:process.stdin}),iterator=lines[Symbol.asyncIterator](),print=value=>console.log(JSON.stringify(value))
const store=new PostgresAuthStore(database),passwords={async hash(){throw new Error('No password work in a transaction')},async verify(){throw new Error('No password work in a transaction')}}
const accounts=new AuthService(store,passwords),schema={'~standard':{version:1,vendor:'operator-native',validate:value=>({value})}}
const outgoing=new Outbox({name:process.env.LONGHORN_OPERATOR_QUEUE,schema,store:new PostgresOutboxStore(database)})
try{
  print({stage:'ready'});await iterator.next()
  if(mode==='raw-revoke'){
    await store.deleteUserSessions(process.env.LONGHORN_OPERATOR_USER)
    print({stage:'done'})
  }else if(mode==='raw-role'){
    await database.execute({sql:"UPDATE longhorn_auth.users SET roles='[\"member\"]'::jsonb WHERE id=$1",args:[process.env.LONGHORN_OPERATOR_USER]})
    print({stage:'done'})
  }else if(mode==='provision'){
    const result=await store.setUserRole(process.env.LONGHORN_OPERATOR_USERNAME,'numbers-operator',false)
    print({stage:'done',status:result.status})
  }else{
    if(mode==='before-commit'){
      const transaction=database.transaction.bind(database)
      database.transaction=work=>transaction(async tx=>{const result=await work(tx);print({stage:'before-commit'});await iterator.next();return result})
    }
    try{
      const value=await outgoing.retryFailedAuthorized(process.env.LONGHORN_OPERATOR_DELIVERY,{expectedMaxAttempts:1,additionalAttempts:1,reason:'provider-restored'},async tx=>{
        print({stage:'checking'})
        const principal=await accounts.authenticateInTransaction(tx,process.env.LONGHORN_OPERATOR_TOKEN)
        if(!principal?.user.roles.includes('numbers-operator'))throw new Error('AUTHORIZATION_DENIED')
        print({stage:'authorized'})
        if(mode==='hold')await iterator.next()
        return{actor:'user:'+principal.user.id}
      })
      print({stage:'result',status:value.result.status,actor:value.audit.actor})
    }catch(error){if(error.message!=='AUTHORIZATION_DENIED')throw error;print({stage:'denied'})}
  }
}finally{lines.close();await outgoing.close();await database.close()}
