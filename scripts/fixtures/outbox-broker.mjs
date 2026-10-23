import { Longhorn } from '../../packages/core/dist/index.js'
import { migrate } from '../../packages/database/dist/index.js'
import { createDurableSqlite } from '../../runtimes/workers/dist/durable-sqlite.js'
import { createQueueWorker } from '../../runtimes/workers/dist/queue.js'
import { createQueuePublisher } from '../../runtimes/workers/dist/outbox.js'
export class BrokerReceipts{
  constructor(state){this.db=createDurableSqlite(state);this.ready=migrate(this.db,[{id:'outbox_broker/001',statements:[
    'CREATE TABLE effects(id TEXT PRIMARY KEY,topic TEXT NOT NULL,payload TEXT NOT NULL) STRICT',
    'CREATE TABLE deliveries(id TEXT NOT NULL,broker_id TEXT NOT NULL) STRICT',
  ]}])}
  async fetch(request){await this.ready;if(request.method==='POST'){
    const {message,brokerId}=await request.json();await this.db.transaction(async tx=>{
      await tx.execute({sql:'INSERT INTO deliveries VALUES(?,?)',args:[message.id,brokerId]})
      await tx.execute({sql:'INSERT INTO effects VALUES(?,?,?) ON CONFLICT(id) DO NOTHING',args:[message.id,message.topic,JSON.stringify(message.data)]})
    });return new Response(null,{status:204})
  }return Response.json({effects:(await this.db.execute('SELECT * FROM effects')).rows,deliveries:(await this.db.execute('SELECT * FROM deliveries')).rows})}
}
const app=new Longhorn(),store=env=>env.RECEIPTS.get(env.RECEIPTS.idFromName('broker'))
app.http.post('/accept',async c=>{await createQueuePublisher(c.env.MESSAGES).publish(await c.req.json(),{signal:c.req.raw.signal});return c.body(null,204)})
app.http.get('/effects',c=>store(c.env).fetch('http://broker/effects'))
export default createQueueWorker(app,{handle:async({message,bindings})=>{
  const response=await store(bindings).fetch('http://broker/store',{method:'POST',body:JSON.stringify({message:message.body,brokerId:message.id})})
  if(!response.ok)throw new Error('Native broker receipt failed');await response.text();return{action:'ack'}
}})
