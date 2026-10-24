import { expect,it } from 'vitest'
import { Hono } from 'hono'
import type { AuthEnv } from '@longhorn/auth/hono'
import { bindAccountViewer } from './viewer-binding.js'
function setup(authenticated=true){
  const app=new Hono<AuthEnv>();let calls=0
  app.use('*',async(c,next)=>{c.set('auth',authenticated?{user:{id:'alice-id',username:'alice',roles:['member']},session:{expiresAt:2000}}:undefined);await next()})
  app.use('*',bindAccountViewer())
  app.get('/',c=>{calls++;return c.json({owner:c.get('auth')?.user.id??null})})
  return{app,calls:()=>calls}
}
it('admits matching viewer claims and keeps ordinary API clients without claims compatible',async()=>{
  const {app,calls}=setup()
  for(const headers of[{}, {'X-LongHorn-Viewer':'alice-id'}]){
    const response=await app.request('/',{headers});expect(response.status).toBe(200);expect(await response.json()).toEqual({owner:'alice-id'})
  }
  expect(calls()).toBe(2)
})
it('rejects a different or empty viewer before private handlers without reflecting claims or clearing valid cookies',async()=>{
  const {app,calls}=setup()
  for(const value of['other-secret-id','']){
    const response=await app.request('/',{headers:{'X-LongHorn-Viewer':value}})
    expect(response.status).toBe(401);expect(response.headers.get('Set-Cookie')).toBeNull();const body=await response.json();expect(body.code).toBe('VIEWER_CHANGED');expect(JSON.stringify(body)).not.toContain('other-secret-id')
  }
  expect(calls()).toBe(0)
})
it('does not turn a viewer claim into authentication and preserves public unclaimed requests',async()=>{
  const {app,calls}=setup(false)
  const response=await app.request('/',{headers:{'X-LongHorn-Viewer':'alice-id'}})
  expect(response.status).toBe(401);expect(await response.json()).toEqual({error:'Authentication required'});expect(calls()).toBe(0)
  expect((await app.request('/')).status).toBe(200);expect(calls()).toBe(1)
})
