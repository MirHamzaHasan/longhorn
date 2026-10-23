import worker,{CommandStore,ReceiptStore} from '../../examples/outbox-worker/dist/index.js'
export{ReceiptStore}
export class FaultCommandStore extends CommandStore{
  constructor(state,env){
    const storage=state.storage,original=storage.setAlarm,boot=crypto.randomUUID()
    storage.setAlarm=async time=>{await original.call(storage,time);if(env.CRASH_BEFORE_COMMIT)state.abort('owned outbox precommit interruption')}
    const binding={async send(message,options){
      const crash=env.CRASH_AFTER_ACCEPT&&!(await storage.get('outbox-crashed'))
      if(crash){await storage.put('outbox-crashed',true);await storage.sync()}
      const result=await env.MESSAGES.send(message,options)
      const sent=await storage.get('outbox-sent')??[];sent.push(message.id);await storage.put('outbox-sent',sent.slice(-16));await storage.sync()
      if(crash){await storage.put('outbox-crash-boot',boot);await storage.sync();state.abort('owned outbox interruption after real broker acceptance')}
      return result
    }}
    super(state,{...env,MESSAGES:binding},{leaseMs:250});this.state=state;this.boot=boot
  }
  async fetch(request){if(new URL(request.url).pathname==='/_fixture/state')return Response.json({boot:this.boot,crashBoot:await this.state.storage.get('outbox-crash-boot'),alarm:await this.state.storage.getAlarm(),sent:await this.state.storage.get('outbox-sent')??[],
    commands:this.state.storage.sql.exec('SELECT id FROM commands').toArray(),jobs:this.state.storage.sql.exec('SELECT id,state,attempts FROM longhorn_queue_jobs').toArray(),requests:this.state.storage.sql.exec('SELECT request_key FROM longhorn_idempotency_requests').toArray()});return super.fetch(request)}
}
export default{...worker,fetch(request,env,ctx){if(new URL(request.url).pathname==='/_fixture/state')return env.COMMANDS.get(env.COMMANDS.idFromName('commands')).fetch(request);return worker.fetch(request,env,ctx)}}
