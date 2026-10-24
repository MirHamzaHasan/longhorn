import{z}from'zod'
export const configSchema=z.object({
  D1_CREATE_LIMIT_ENABLED:z.enum(['true','false']).default('false').transform(value=>value==='true'),
  D1_CREATE_LIMIT_REQUESTS:z.string().regex(/^\d+$/).default('60').transform(Number).pipe(z.number().int().min(1).max(1000000)),
  D1_CREATE_LIMIT_WINDOW_MS:z.string().regex(/^\d+$/).default('60000').transform(Number).pipe(z.number().int().min(1000).max(86400000)),
  D1_MAX_PENDING:z.string().regex(/^\d+$/).default('6').transform(Number).pipe(z.number().int().min(1).max(64)),
  D1_REQUEST_RETENTION_MS:z.string().regex(/^\d+$/).default('86400000').transform(Number).pipe(z.number().int().min(1).max(2592000000)),
}).transform(value=>({maxPending:value.D1_MAX_PENDING,retentionMs:value.D1_REQUEST_RETENTION_MS,...(value.D1_CREATE_LIMIT_ENABLED?{createLimits:{limit:value.D1_CREATE_LIMIT_REQUESTS,windowMs:value.D1_CREATE_LIMIT_WINDOW_MS}}:{})}))
export type D1Config=Readonly<z.output<typeof configSchema>>
export const title=z.string().trim().min(1).max(200)
export const createSchema=z.object({title}).strict()
export const updateSchema=z.object({revision:z.number().int().min(1).max(2147483647),title:title.optional(),completed:z.boolean().optional()}).strict().refine(value=>value.title!==undefined||value.completed!==undefined,'Supply title or completed')
export const deleteSchema=z.object({revision:z.number().int().min(1).max(2147483647)}).strict()
export const idSchema=z.object({id:z.string().uuid()})
export const cursor=z.string().regex(/^(0|[1-9]\d{0,18})$/).pipe(z.string().refine(value=>BigInt(value)<=9223372036854775807n,'Cursor outside int64 range'))
export const pageSchema=z.object({after:cursor.default('0'),limit:z.string().regex(/^\d+$/).default('20').transform(Number).pipe(z.number().int().min(1).max(50))}).strict()
