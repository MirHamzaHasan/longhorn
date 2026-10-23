import { resolveServeOptions } from '@longhorn/runtime'
import type { FetchApplication, RuntimeAdapter, ServerHandle, ServeOptions } from '@longhorn/runtime'

export const PACKAGE_NAME = '@longhorn/bun'

export async function serve(application: FetchApplication, options: ServeOptions = {}): Promise<ServerHandle> {
  if (typeof Bun === 'undefined') throw new Error('The Bun adapter must run in Bun')
  const { hostname, port } = resolveServeOptions(options)
  const server = Bun.serve({
    hostname, port, reusePort: false, development: false,
    fetch: (request) => application.fetch(request),
    error(error) {
      console.error(error)
      return Response.json({ error: 'Internal Server Error' }, { status: 500 })
    },
  })
  if (server.port === undefined) {
    await server.stop()
    throw new Error('Bun adapter did not receive a TCP port')
  }
  let closing: Promise<void> | undefined
  return {
    hostname: server.hostname ?? hostname,
    port: server.port,
    url: server.url.origin,
    close() {
      closing ??= server.stop()
      return closing
    },
  }
}

export const bunRuntime: RuntimeAdapter = Object.freeze({ name: 'bun', serve })
