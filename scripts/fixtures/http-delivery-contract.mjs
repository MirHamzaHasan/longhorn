import { createHttpPublisher } from '../../packages/outbox/dist/http.js'
import { createJsonClient } from '../../packages/http/dist/client.js'
export async function verifyHttpDelivery(baseUrl,token){
  const options={baseUrl,token,allowInsecureLoopback:true,timeoutMs:3000},publisher=createHttpPublisher(options),client=createJsonClient(options)
  const message={id:crypto.randomUUID(),topic:'command.numbers.v1',data:{commandId:crypto.randomUUID(),numbers:[4,6]}}
  const context={attempt:1,maxAttempts:3,signal:new AbortController().signal}
  await publisher.publish(message,context);await publisher.publish(message,context)
  const receipt=await client.request('receipts/'+message.data.commandId),health=await client.request('health')
  if(receipt.status!==200||receipt.data.receipts.length!==1||receipt.data.receipts[0].messageId!==message.id||receipt.data.receipts[0].result.sum!==10||health.status!==200||health.data.ready!==true)throw new Error('Native HTTP delivery contract failed')
  return{httpDelivery:true,deduplicated:true,protectedReceipt:true}
}
export default{async fetch(request,env){return Response.json(await verifyHttpDelivery(env.SERVICE_URL,env.SERVICE_TOKEN))}}
