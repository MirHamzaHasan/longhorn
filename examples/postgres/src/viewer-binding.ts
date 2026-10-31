import type { MiddlewareHandler } from 'hono'
import type { AuthEnv } from '@longhornjs/auth/hono'

/** Optional consistency claim, never an authentication or ownership credential. */
export function bindAccountViewer<E extends AuthEnv>():MiddlewareHandler<E>{
  return async(c,next)=>{
    const expected=c.req.header('X-LongHorn-Viewer')
    if(expected!==undefined){
      const actual=c.get('auth')?.user.id
      if(!actual)return c.json({error:'Authentication required'},401)
      if(expected!==actual)return c.json({error:'The active account changed. Sign in or reload to continue.',code:'VIEWER_CHANGED'},401)
    }
    await next()
  }
}
