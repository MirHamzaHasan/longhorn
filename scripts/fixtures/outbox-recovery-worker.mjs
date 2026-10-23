import worker,{CommandStore,ReceiptStore,commandMigrations} from '../../examples/outbox-worker/dist/index.js'
import { migrate } from '../../packages/database/dist/index.js'
import { createDurableSqlite } from '../../runtimes/workers/dist/durable-sqlite.js'
import { createQueuePublisher } from '../../runtimes/workers/dist/outbox.js'
import { Outbox } from '../../packages/outbox/dist/index.js'
import { SqliteOutboxStore,outboxRecoveryMigrations,outboxAuditMigrations } from '../../packages/outbox/dist/sqlite.js'
export{ReceiptStore}
export class RecoveryCommandStore{
  constructor(state,env){
    this.state=state;this.boot=crypto.randomUUID();this.retrying=false
    const storage=state.storage,original=storage.setAlarm
    storage.setAlarm=async time=>{await original.call(storage,time);if(env.ABORT_RETRY_COMMIT&&this.retrying)state.abort('owned retry/wakeup commit interruption')}
    const binding={async send(message,options){const result=await env.MESSAGES.send(message,options);const sent=await storage.get('recovery-sent')??[];sent.push(message.id);await storage.put('recovery-sent',sent.slice(-16));return result}}
    this.ready=(async()=>{
      if(!(await storage.get('recovery-seed'))){
        const db=createDurableSqlite(state)
        // Reproduce the prior release's immutable history, then let the compiled app append the recovery index.
        const feature=env.SEED_BEFORE_AUDIT?outboxAuditMigrations[0].id:outboxRecoveryMigrations[0].id
        const recoveryIndex=commandMigrations.findIndex(migration=>migration.id===feature)
        if(recoveryIndex<0)throw new Error('Legacy recovery prefix is unavailable')
        await migrate(db,commandMigrations.slice(0,recoveryIndex))
        const schema={'~standard':{version:1,vendor:'legacy-command',validate:value=>({value})}}
        const outgoing=new Outbox({name:'command.numbers.v1',schema,store:new SqliteOutboxStore(db)})
        try{
          const commandId=crypto.randomUUID(),delivery=await db.transaction(async tx=>{
            await tx.execute({sql:'INSERT INTO commands(id,numbers) VALUES(?,?)',args:[commandId,'[3,5]']})
            return outgoing.enqueueInTransaction(tx,{commandId,numbers:[3,5]},{maxAttempts:1})
          })
          const publisher=createQueuePublisher(binding)
          const failed=await outgoing.dispatchOnce({async publish(message,context){await publisher.publish(message,context);throw new Error('owned ambiguous acceptance')}})
          if(failed.status!=='failed')throw new Error('Legacy outgoing record did not become terminal')
          await storage.put('recovery-seed',{commandId,id:delivery.id});await storage.sync()
        }finally{await outgoing.close();await db.close()}
      }
      return new CommandStore(state,{...env,MESSAGES:binding})
    })()
  }
  async fetch(request){
    const app=await this.ready,path=new URL(request.url).pathname
    if(path==='/_fixture/state')return Response.json({boot:this.boot,seed:await this.state.storage.get('recovery-seed'),sent:await this.state.storage.get('recovery-sent')??[],alarm:await this.state.storage.getAlarm(),
      history:this.state.storage.sql.exec('SELECT id FROM longhorn_migrations ORDER BY position').toArray(),jobs:this.state.storage.sql.exec('SELECT id,state,attempts,max_attempts FROM longhorn_queue_jobs').toArray()})
    this.retrying=request.method==='POST'&&path.endsWith('/retry')
    try{return await app.fetch(request)}finally{this.retrying=false}
  }
  async alarm(info){return(await this.ready).alarm(info)}
}
export default{...worker,fetch(request,env,ctx){if(new URL(request.url).pathname==='/_fixture/state')return env.COMMANDS.get(env.COMMANDS.idFromName('commands')).fetch(request);return worker.fetch(request,env,ctx)}}
