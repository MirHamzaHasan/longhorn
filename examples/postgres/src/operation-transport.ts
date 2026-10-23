import { createJsonClient } from '@longhorn/http/client'
import { createHttpPublisher } from '@longhorn/outbox/http'
import { z } from 'zod'
import type { OperatorConfig } from './operator-config.js'
import type { AccountOperationsOptions } from './operations.js'
import type { OperationData } from './operation-contracts.js'

const receiptPage=z.object({receipts:z.array(z.object({messageId:z.uuid(),result:z.object({count:z.number().int().min(1).max(100),sum:z.number().finite(),min:z.number().finite(),max:z.number().finite()}).strict()}).strict()).min(1).max(100)}).strict()
export function createOperationTransport(config: OperatorConfig): AccountOperationsOptions {
  const options={baseUrl:config.messageBaseUrl,token:config.messageToken,allowInsecureLoopback:config.allowInsecureLoopback,timeoutMs:config.timeoutMs}
  const client=createJsonClient(options)
  return {
    ...(config.dispatchEnabled?{publisher:createHttpPublisher<OperationData>(options)}:{}),
    checkHealth:async signal=>{
      const response=await client.request('health',{signal})
      return response.status===200 && !!response.data && typeof response.data==='object' && Object.keys(response.data).length===1 && (response.data as {ready?:unknown}).ready===true
    },
    readReceipt:async(id,signal)=>{
      try{
        const response=await client.request('receipts/'+id,{signal})
        if(response.status===404)return Response.json({error:'Receipt not found'},{status:404})
        const parsed=receiptPage.safeParse(response.data)
        if(response.status!==200 || !parsed.success)return Response.json({error:'Receipt service is unavailable'},{status:503})
        return Response.json(parsed.data)
      }catch{return Response.json({error:'Receipt service is unavailable'},{status:503})}
    },
  }
}
