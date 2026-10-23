import { z } from 'zod'

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
})

export const updateTaskSchema = z.object({
  completed: z.boolean(),
})
