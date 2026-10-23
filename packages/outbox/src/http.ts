import { createJsonClient } from '@longhorn/http/client'
import type { JsonClientOptions } from '@longhorn/http/client'
import type { MessagePublisher } from './index.js'

export class HttpPublishError extends Error {
  constructor(readonly code: 'http' | 'acknowledgement',readonly status?: number) { super('HTTP message delivery failed: '+code);this.name='HttpPublishError' }
}
/** POST messages; only a synchronous matching acknowledgement completes delivery. The Outbox owns retries. */
export function createHttpPublisher<T>(options: JsonClientOptions): MessagePublisher<T> {
  const client=createJsonClient(options)
  const publisher: MessagePublisher<T> = {async publish(message,context){
    const response=await client.request('messages',{method:'POST',value:{id:message.id,topic:message.topic,data:message.data},signal:context.signal})
    if(response.status!==200)throw new HttpPublishError('http',response.status)
    const value=response.data
    if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==2 ||
      (value as {id?:unknown}).id!==message.id || (value as {accepted?:unknown}).accepted!==true)throw new HttpPublishError('acknowledgement')
  }}
  return Object.freeze(publisher)
}
