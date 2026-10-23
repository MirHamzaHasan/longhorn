import { expect,it,vi } from 'vitest'
import { createHttpPublisher } from './http.js'
const message={id:crypto.randomUUID(),topic:'command.numbers.v1',data:{numbers:[1,2]}},context={attempt:1,maxAttempts:3,signal:new AbortController().signal}
const options={baseUrl:'https://receiver.example/',token:'a'.repeat(64)}
it('sends the stable envelope once and accepts only its synchronous matching acknowledgement',async()=>{
  const send=vi.fn(async()=>Response.json({id:message.id,accepted:true}))
  await createHttpPublisher({...options,fetch:send}).publish(message,context);expect(send).toHaveBeenCalledTimes(1)
  expect(JSON.parse(String((send.mock.calls[0] as unknown as [string,RequestInit])[1].body))).toEqual(message)
  for(const value of [{id:crypto.randomUUID(),accepted:true},{id:message.id,accepted:false},{id:message.id,accepted:true,secret:'ignored?'},{}])await expect(createHttpPublisher({...options,fetch:async()=>Response.json(value)}).publish(message,context)).rejects.toMatchObject({code:'acknowledgement'})
  await expect(createHttpPublisher({...options,fetch:async()=>Response.json({id:message.id,accepted:true},{status:202})}).publish(message,context)).rejects.toMatchObject({code:'http',status:202})
})
