import type { DurableObjectId } from '@cloudflare/workers-types'
import { createBearerVerifier } from '@longhorn/auth/bearer'
import { Longhorn } from '@longhorn/core'
import { validate } from '@longhorn/validation/hono'
import { createWorker } from '@longhorn/workers'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { envelope } from './contracts.js'
import { numbersReceipt } from './message-effect.js'
export { ReceiptStore } from './receipts.js'

type ReceiptNamespace={idFromName(name:string):DurableObjectId;get(id:DurableObjectId):{fetch(input:string,init?:RequestInit):Promise<Response>}}
type Bindings={RECEIVER_TOKEN: string;RECEIPTS: ReceiptNamespace}
const app=new Longhorn<Bindings>()
let configured: string | undefined,verify: ReturnType<typeof createBearerVerifier> | undefined
const object=(env: Bindings)=>env.RECEIPTS.get(env.RECEIPTS.idFromName('receipts'))
app.http.use('*',async(c,next)=>{
  c.header('Cache-Control','no-store');c.header('Vary','Authorization')
  if(!verify || configured!==c.env.RECEIVER_TOKEN){
    try{verify=createBearerVerifier(c.env.RECEIVER_TOKEN);configured=c.env.RECEIVER_TOKEN}
    catch{return c.json({error:'Receiver credential is not configured'},503)}
  }
  if(!await verify(c.req.header('Authorization'))){c.header('WWW-Authenticate','Bearer');return c.json({error:'Authentication required'},401)}
  await next()
})
app.http.use('*',bodyLimit({maxSize:16384,onError:c=>c.json({error:'Request body too large'},413)}))
app.http.get('/health',async c=>{
  const response=await object(c.env).fetch('http://receipts/health');await response.text()
  return response.ok?c.json({ready:true}):c.json({error:'Receipt storage is unavailable'},503)
})
app.http.post('/messages',validate('json',envelope),async c=>{
  const message=c.req.valid('json'),stored=await object(c.env).fetch('http://receipts/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(numbersReceipt(message))})
  await stored.text()
  if(stored.status===409)return c.json({error:'Message ID already has a different effect'},409)
  if(stored.status!==204)return c.json({error:'Receipt storage is unavailable'},503)
  return c.json({id:message.id,accepted:true})
})
app.http.get('/receipts/:id',validate('param',z.object({id:z.uuid()})),c=>object(c.env).fetch('http://receipts/receipts/'+c.req.valid('param').id))
export default createWorker(app)
