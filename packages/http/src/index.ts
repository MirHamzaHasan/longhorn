import { Hono } from 'hono'
import type { Context, Env } from 'hono'
import { HTTPException } from 'hono/http-exception'

export const PACKAGE_NAME = '@longhornjs/http'

/** Keep Hono's routing, middleware, and type inference intact. */
export type HttpAppOptions<E extends Env = Env> = {
  onError?: (error: Error, context: Context<E>) => void
}

export function createHttpApp<E extends Env = Env>(options: HttpAppOptions<E> = {}): Hono<E> {
  const app = new Hono<E>()

  app.notFound((c) => c.json({ error: 'Not Found' }, 404))
  app.onError((error, c) => {
    // Explicit responses retain their body and headers; message-only errors use JSON.
    if (error instanceof HTTPException) {
      return error.res ? error.getResponse() : c.json({ error: error.message }, error.status)
    }
    if (options.onError) options.onError(error, c)
    else console.error(error)
    return c.json({ error: 'Internal Server Error' }, 500)
  })

  return app
}

export { Hono, HTTPException }
export type { Context, Env, Handler, MiddlewareHandler } from 'hono'
