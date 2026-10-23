import worker,{RecoveryCommandStore,ReceiptStore} from './outbox-recovery-worker.mjs'
import { createDurableSqlite } from '../../runtimes/workers/dist/durable-sqlite.js'
import { Outbox } from '../../packages/outbox/dist/index.js'
import { SqliteOutboxStore } from '../../packages/outbox/dist/sqlite.js'
export{ReceiptStore}
export class AuditedCommandStore extends RecoveryCommandStore{
  constructor(state,env){super(state,{...env,SEED_BEFORE_AUDIT:true})}
  async fetch(request){
    const path=new URL(request.url).pathname
    if(path==='/_fixture/state'){
      const response=await super.fetch(request),data=await response.json()
      return Response.json({...data,audits:this.state.storage.sql.exec('SELECT id,actor,reason,outcome FROM longhorn_outbox_recovery_audit').toArray()})
    }
    if(path==='/_fixture/prune-job'||path==='/_fixture/prune-audit'){
      await request.arrayBuffer()
      await this.ready
      const db=createDurableSqlite(this.state),schema={'~standard':{version:1,vendor:'audit-maintenance',validate:value=>({value})}}
      const outgoing=new Outbox({name:'command.numbers.v1',schema,store:new SqliteOutboxStore(db)})
      try{return Response.json({removed:path.endsWith('prune-job')?await outgoing.prune({before:Date.now()}):await outgoing.pruneAudit({before:Date.now(),limit:1})})}
      finally{await outgoing.close();await db.close()}
    }
    return super.fetch(request)
  }
}
export default{...worker,fetch(request,env,ctx){if(new URL(request.url).pathname.startsWith('/_fixture/'))return env.COMMANDS.get(env.COMMANDS.idFromName('commands')).fetch(request);return worker.fetch(request,env,ctx)}}
