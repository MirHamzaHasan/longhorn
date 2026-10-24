import type { Database } from '@longhorn/database'
import type { Longhorn,LonghornEnv } from '@longhorn/core'
import { provide,token } from '@longhorn/container'
import type { Token } from '@longhorn/container'
import type { AuthEnv } from '@longhorn/auth/hono'
import type { MiddlewareHandler } from 'hono'
import { RateLimiter,RateLimitError } from '@longhorn/ratelimit'
import { PostgresRateLimitStore } from '@longhorn/ratelimit/postgres'
import { rateLimit } from '@longhorn/ratelimit/hono'
export type CommandLimitOptions={readonly limit?:number;readonly windowMs?:number;readonly now?:()=>number}
export const PgCommandLimits=token<RateLimiter>('authenticated command attempt limits')
type Env=LonghornEnv&AuthEnv
export async function checkCommandLimitAccess(database:Database):Promise<void>{
  await database.execute('SELECT scope,subject_hash,policy_limit,window_ms,attempts,expires_at FROM longhorn_rate_limit.buckets LIMIT 0')
  const row=(await database.execute("SELECT (has_table_privilege(current_user,'longhorn_rate_limit.buckets','SELECT') AND has_table_privilege(current_user,'longhorn_rate_limit.buckets','INSERT') AND has_table_privilege(current_user,'longhorn_rate_limit.buckets','UPDATE')) AS allowed")).rows[0]
  if(row?.allowed!==true)throw new Error('Command request limits require runtime SELECT/INSERT/UPDATE grants')
}
/** Called after authentication; this is an attempt budget, including retries and invalid bodies. */
export function configureCommandLimits(app:Longhorn,dbToken:Token<Database>,options?:CommandLimitOptions):MiddlewareHandler<Env>{
  if(!options)return async(_c,next)=>{await next()}
  const policy={...options}
  app.container.register(provide(PgCommandLimits,{deps:[dbToken],factory:db=>new RateLimiter({...policy,scope:'account.commands.v1',store:new PostgresRateLimitStore(db)})}))
  app.onStart(()=>{const limiter=app.container.resolve(PgCommandLimits);return()=>limiter.close()})
  return async(c,next)=>rateLimit<Env>(c.get('container').resolve(PgCommandLimits),context=>context.get('auth')!.user.id,{onError:(error,context)=>{
    context.get('logger').warn('Command request limit unavailable',{reason:error instanceof RateLimitError?error.code:'store'})
  }})(c,next)
}
