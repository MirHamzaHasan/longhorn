import { z } from 'zod'

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
})

export const updateTaskSchema = z.object({
  completed: z.boolean(),
})

const cursor = z.string().refine(value => /^[1-9]\d{0,18}$/.test(value)
  && BigInt(value) <= 9223372036854775807n, 'Expected a positive int64 cursor')
export const taskListQuery = z.object({
  limit: z.string().regex(/^[1-9]\d{0,2}$/).default('20').transform(Number)
    .pipe(z.number().int().min(1).max(100)),
  after: cursor.optional(),
  completed: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
}).strict().transform(({ limit, after, completed }) => ({
  limit,
  ...(after === undefined ? {} : { after }),
  ...(completed === undefined ? {} : { completed }),
}))
