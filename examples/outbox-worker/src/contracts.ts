import { z } from 'zod'
export const topic = 'command.numbers.v1'
export const numbers = z.array(z.number().finite().min(-1e12).max(1e12)).min(1).max(100)
export const commandInput = z.object({ id: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/), numbers }).strict()
export const messageData = z.object({ commandId: z.uuid(), numbers }).strict()
export const envelope = z.object({ id: z.uuid(), topic: z.literal(topic), data: messageData }).strict()
export const receipt = z.object({ messageId: z.uuid(), commandId: z.uuid(), result: z.object({
  count: z.number().int().min(1).max(100), sum: z.number().finite(), min: z.number().finite(), max: z.number().finite(),
}).strict() }).strict()
