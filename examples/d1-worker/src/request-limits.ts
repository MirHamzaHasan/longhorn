import type { Longhorn,LonghornEnv } from '@longhornjs/core'
import type { BatchDatabase } from '@longhornjs/database'
import { provide,token } from '@longhornjs/container'
import type { Token } from '@longhornjs/container'
import { RateLimiter } from '@longhornjs/ratelimit'
import { BatchSqliteRateLimitStore } from '@longhornjs/ratelimit/batch-sqlite'
import { rateLimit } from '@longhornjs/ratelimit/hono'
import type { MiddlewareHandler } from 'hono'
export type CreateLimitOptions={readonly limit:number;readonly windowMs:number}
export const TaskCreateLimits=token<RateLimiter>('D1 public task creation budget')
/** The existing public API has one database-wide budget; callers cannot select identities. */
export function configureTaskCreateLimits(app:Longhorn,database:Token<BatchDatabase>,options?:CreateLimitOptions):MiddlewareHandler<LonghornEnv>{
  if(!options)return async(_c,next)=>{await next()}
  const policy={...options}
  app.container.register(provide(TaskCreateLimits,{deps:[database],factory:db=>new RateLimiter({...policy,scope:'public.tasks.create.v1',store:new BatchSqliteRateLimitStore(db)})}))
  app.onStart(()=>{const limiter=app.container.resolve(TaskCreateLimits);return()=>limiter.close()})
  return async(c,next)=>rateLimit<LonghornEnv>(c.get('container').resolve(TaskCreateLimits),()=> 'application')(c,next)
}
