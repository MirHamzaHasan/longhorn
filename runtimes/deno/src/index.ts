import { resolveServeOptions } from '@longhornjs/runtime'
import type { FetchApplication, RuntimeAdapter, ServerHandle, ServeOptions } from '@longhornjs/runtime'

export const PACKAGE_NAME = '@longhornjs/deno'

export async function serve(application: FetchApplication, options: ServeOptions = {}): Promise<ServerHandle> {
  if (typeof Deno === 'undefined') throw new Error('The Deno adapter must run in Deno')
  const { hostname, port } = resolveServeOptions(options)
  const server = Deno.serve({
    hostname, port, reusePort: false, onListen() {},
    onError(error) {
      console.error(error)
      return Response.json({ error: 'Internal Server Error' }, { status: 500 })
    },
  }, (request) => application.fetch(request))
  const address = server.addr
  let closing: Promise<void> | undefined
  return {
    hostname: address.hostname,
    port: address.port,
    url: `http://${address.hostname.includes(':') ? `[${address.hostname}]` : address.hostname}:${address.port}`,
    close() {
      closing ??= server.shutdown().then(() => server.finished)
      return closing
    },
  }
}

export const denoRuntime: RuntimeAdapter = Object.freeze({ name: 'deno', serve })
