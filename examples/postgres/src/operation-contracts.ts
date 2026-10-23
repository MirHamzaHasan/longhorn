import { z } from 'zod'
export const operatorRole = 'numbers-operator'
export const operationTopic = 'command.numbers.v1'
export const numberValues = z.array(z.number().finite().min(-1e12).max(1e12)).min(1).max(100)
export const commandSchema = z.object({ id: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/), numbers: numberValues }).strict()
export const operationData = z.object({ commandId: z.uuid(), numbers: numberValues }).strict()
export type OperationData = z.output<typeof operationData>
