import { Longhorn } from '@longhorn/core'
import type { LonghornEnv } from '@longhorn/core'
import { provide,token } from '@longhorn/container'
import { createBearerVerifier } from '@longhorn/auth/bearer'
import type { Logger } from '@longhorn/logger'
import { RateLimiter,RateLimitError } from '@longhorn/ratelimit'
import { RedisRateLimitStore } from '@longhorn/ratelimit/redis'
import type { RedisRateLimitClient } from '@longhorn/ratelimit/redis'
import { rateLimit } from '@longhorn/ratelimit/hono'
import { Readiness } from '@longhorn/observability'
import { livenessHandler,readinessHandler } from '@longhorn/observability/hono'
import { validate } from '@longhorn/validation/hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
export interface OwnedLimitClient extends RedisRateLimitClient {close():Promise<void>}
export const LimitClient=token<OwnedLimitClient>('owned Redis rate limit connection'),ReportLimits=token<RateLimiter>('shared report attempts')
const input=z.object({numbers:z.array(z.number().finite().min(-1e12).max(1e12)).min(1).max(100)}).strict()
/** A bearer capability is mapped to one stable configured budget subject, never to request data. */
export function createRedisLimitsApp(options:{openClient:()=>Promise<OwnedLimitClient>;apiToken:string;subject:string;namespace:string;limit:number;windowMs:number;logger?:Logger}):Longhorn{
  const config={...options},verify=createBearerVerifier(config.apiToken),app=new Longhorn(config.logger?{logger:config.logger}:{}),readiness=new Readiness()
  app.container.register(provide(ReportLimits,{deps:[LimitClient],factory:client=>new RateLimiter({scope:'reports.submit.v1',limit:config.limit,windowMs:config.windowMs,store:new RedisRateLimitStore(client,{namespace:config.namespace})})}))
  app.onStart(async()=>{const client=await config.openClient();app.container.register(provide(LimitClient,{factory:()=>client}));return()=>client.close()})
  app.onStart(()=>{const limiter=app.container.resolve(ReportLimits);return()=>limiter.close()})
  readiness.add('redis',async({signal})=>!signal.aborted&&await app.container.resolve(LimitClient).execute(['PING'])==='PONG')
  app.onStart(async()=>{if(await app.container.resolve(LimitClient).execute(['PING'])!=='PONG')throw new Error('Redis health failed');readiness.start();return()=>readiness.close()})
  app.http.use('*',async(c,next)=>{c.header('Cache-Control','no-store');await next()})
  app.http.use('*',bodyLimit({maxSize:8192,onError:c=>c.json({error:'Request body too large'},413)}))
  app.http.get('/livez',livenessHandler(()=>app.state!=='failed'&&app.state!=='stopped'))
  app.http.get('/readyz',readinessHandler(readiness))
  app.http.post('/reports',async(c,next)=>{if(!await verify(c.req.header('authorization')))return c.json({error:'Authentication required'},401);await next()},async(c,next)=>rateLimit<LonghornEnv>(c.get('container').resolve(ReportLimits),()=>config.subject,{onError:(error,context)=>{context.get('logger').warn('Report request limit unavailable',{reason:error instanceof RateLimitError?error.code:'store'})}})(c,next),validate('json',input),c=>{
    const numbers=c.req.valid('json').numbers
    return c.json({result:{count:numbers.length,sum:numbers.reduce((sum,value)=>sum+value,0)}},200)
  })
  return app
}
