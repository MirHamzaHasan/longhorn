import { expect,it,vi } from 'vitest'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { RateLimiter } from './index.js'
import { MemoryRateLimitStore } from './memory.js'
import { rateLimit } from './hono.js'
it('uses an explicitly selected identity and returns a private 429 delta-seconds reply',async()=>{
  let now=0,effects=0;const limiter=new RateLimiter({scope:'http',store:new MemoryRateLimitStore(),limit:1,windowMs:1500,now:()=>now}),app=new Hono()
  app.post('/',rateLimit(limiter,c=>c.req.header('x-test-identity')!),c=>{effects++;return c.json({accepted:true})})
  const request=()=>app.request('/',{method:'POST',headers:{'x-test-identity':'private-user'}})
  expect((await request()).status).toBe(200);const blocked=await request();expect(blocked.status).toBe(429);expect(blocked.headers.get('retry-after')).toBe('2');expect(blocked.headers.get('cache-control')).toBe('no-store');expect(await blocked.text()).not.toContain('private-user');expect(effects).toBe(1);now=1500;expect((await request()).status).toBe(200);await limiter.close()
})
it('fails closed on store errors and keeps downstream/resolver HTTP failures outside its catch',async()=>{
  const limiter=new RateLimiter({scope:'errors',store:{async consume(){throw new Error('private SQL details')},async prune(){return 0}}}),app=new Hono();let effects=0
  app.get('/failed',rateLimit(limiter,()=> 'a'),c=>{effects++;return c.text('unexpected')})
  const valid=new RateLimiter({scope:'valid',store:new MemoryRateLimitStore()})
  app.get('/next',rateLimit(valid,()=> 'a'),()=>{throw new HTTPException(418)})
  app.get('/identity',rateLimit(valid,()=>{throw new HTTPException(401)}),c=>c.text('unexpected'))
  const failed=await app.request('/failed');expect(failed.status).toBe(503);expect(await failed.text()).not.toContain('private');expect(effects).toBe(0)
  expect((await app.request('/next')).status).toBe(418);expect((await app.request('/identity')).status).toBe(401);await limiter.close();await valid.close()
})
it('awaits the explicit error observer before publishing the unavailable reply',async()=>{
  let release!:()=>void,observed:unknown,published=false
  const held=new Promise<void>(done=>{release=done}),failure=new Error('private provider failure')
  const limiter=new RateLimiter({scope:'observer',store:{async consume(){throw failure},async prune(){return 0}}}),app=new Hono()
  app.get('/',rateLimit(limiter,()=> 'subject',{onError:async error=>{observed=error;await held}}),c=>c.text('unexpected'))
  const request=Promise.resolve(app.request('/')).then(value=>{published=true;return value})
  await vi.waitFor(()=>expect(observed).toBe(failure));expect(published).toBe(false);release()
  expect((await request).status).toBe(503);await limiter.close()
})
