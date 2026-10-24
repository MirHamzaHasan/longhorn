import type { Context,Env,MiddlewareHandler } from 'hono'
import type { RateLimiter } from './index.js'
/** Caller owns identity/trusted-proxy policy; provider failures never admit the handler. */
export function rateLimit<E extends Env=Env>(limiter:RateLimiter,key:(context:Context<E>)=>string|Promise<string>,options:{readonly onError?:(error:unknown,context:Context<E>)=>void|Promise<void>}={}):MiddlewareHandler<E>{
  const observe=options.onError
  return async(c,next)=>{
    const subject=await key(c)
    let decision
    try{decision=await limiter.consume(subject)}catch(error){await observe?.(error,c);c.header('Cache-Control','no-store');return c.json({error:'Request limit is unavailable'},503)}
    if(!decision.allowed){c.header('Cache-Control','no-store');c.header('Retry-After',String(Math.max(1,Math.ceil(decision.retryAfterMs/1000))));return c.json({error:'Too many requests. Try again later.'},429)}
    await next()
  }
}
