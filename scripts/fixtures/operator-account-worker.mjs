import { Longhorn } from '../../packages/core/dist/index.js'
import { migrate } from '../../packages/database/dist/index.js'
import { AuthService } from '../../packages/auth/dist/index.js'
import { SqliteAuthStore,authMigrations } from '../../packages/auth/dist/sqlite.js'
import { Outbox } from '../../packages/outbox/dist/index.js'
import { SqliteOutboxStore,outboxMigrations,outboxRecoveryMigrations,outboxAuditMigrations } from '../../packages/outbox/dist/sqlite.js'
import { queueMigrations } from '../../packages/queue/dist/sqlite.js'
import { createDurableSqlite } from '../../runtimes/workers/dist/durable-sqlite.js'

export class AccountStore {
  constructor(state){
    const app=this.app=new Longhorn(),database=createDurableSqlite(state),store=new SqliteAuthStore(database)
    const passwords={async hash(){throw new Error('No Worker password provider')},async verify(){throw new Error('No Worker password provider')}}
    const auth=new AuthService(store,passwords),schema={'~standard':{version:1,vendor:'object-operator',validate:value=>({value})}}
    const outgoing=new Outbox({name:'object-operator.v1',schema,store:new SqliteOutboxStore(database)})
    app.onStart(async()=>{await migrate(database,[...authMigrations,...queueMigrations,...outboxMigrations,...outboxRecoveryMigrations,...outboxAuditMigrations]);await store.createUser({id:'worker-user',username:'worker-user',roles:['member'],passwordHash:'unused-fixture-hash'});return()=>database.close()})
    app.http.post('/run',async c=>{
      const original=await auth.sessions.create('worker-user'),delivery=await outgoing.enqueue({value:1},{maxAttempts:1})
      await outgoing.dispatchOnce({async publish(){throw new Error('Owned failure')}})
      let token=original.token
      const policy=async tx=>{const principal=await auth.authenticateInTransaction(tx,token);if(!principal?.user.roles.includes('numbers-operator'))throw new Error('denied');return{actor:'user:'+principal.user.id}}
      const request={expectedMaxAttempts:1,additionalAttempts:1,reason:'provider-restored'}
      let denied=false
      try{await outgoing.retryFailedAuthorized(delivery.id,request,policy)}catch(error){if(error.message!=='denied')throw error;denied=true}
      const deniedAudit=(await outgoing.auditHistory()).records.length
      const granted=await store.setUserRole('worker-user','numbers-operator',true),revoked=await database.transaction(tx=>auth.authenticateInTransaction(tx,original.token))===undefined
      token=(await auth.sessions.create('worker-user')).token
      const transaction=database.transaction.bind(database)
      database.transaction=work=>transaction(async tx=>{await work(tx);await state.storage.setAlarm(Date.now()+60000);throw new Error('Owned commit abort')})
      let rolledBack=false
      try{await outgoing.retryFailedAuthorized(delivery.id,request,policy)}catch(error){if(error.message!=='Owned commit abort')throw error;rolledBack=true}finally{database.transaction=transaction}
      const afterAbort={delivery:await outgoing.get(delivery.id),records:(await outgoing.auditHistory()).records,alarm:await state.storage.getAlarm()}
      const result=await outgoing.retryFailedAuthorized(delivery.id,request,policy)
      await store.setUserRole('worker-user','numbers-operator',false)
      return c.json({denied,deniedAudit,revoked,granted:granted.status,rolledBack,afterAbort,result,demoted:await database.transaction(tx=>auth.authenticateInTransaction(tx,token))===undefined})
    })
    app.http.onError((error,c)=>c.json({error:error.message},500))
  }
  fetch(request){return this.app.fetch(request)}
  async alarm(){}
}
export default {fetch(request,env){return env.ACCOUNTS.get(env.ACCOUNTS.idFromName('principal')).fetch(request)}}
