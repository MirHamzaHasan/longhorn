import type { z } from 'zod'
import type { envelope } from './contracts.js'

export function numbersReceipt(message: z.infer<typeof envelope>) {
  const values=message.data.numbers
  return {messageId:message.id,commandId:message.data.commandId,result:{count:values.length,sum:values.reduce((a,b)=>a+b,0),min:Math.min(...values),max:Math.max(...values)}}
}
