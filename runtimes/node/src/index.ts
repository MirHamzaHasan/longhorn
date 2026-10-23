import { createAdaptorServer } from '@hono/node-server'
import type { FetchApplication, RuntimeAdapter, ServerHandle, ServeOptions } from '@longhorn/runtime'
import { resolveServeOptions } from '@longhorn/runtime'

export const PACKAGE_NAME = '@longhorn/node'

/** Resolve only once the socket is listening; startup errors reject the promise. */
export async function serve(
  application: FetchApplication,
  options: ServeOptions = {},
): Promise<ServerHandle> {
  const { hostname, port } = resolveServeOptions(options)
  const server = createAdaptorServer({ fetch: (request) => application.fetch(request) })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(port, hostname, () => {
      server.off('error', onError)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Node adapter did not receive a TCP address')
  }

  let closing: Promise<void> | undefined
  return {
    hostname: address.address,
    port: address.port,
    url: `http://${address.family === 'IPv6' ? `[${address.address}]` : address.address}:${address.port}`,
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
      return closing
    },
  }
}

export const nodeRuntime: RuntimeAdapter = Object.freeze({ name: 'node', serve })
