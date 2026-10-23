export const PACKAGE_NAME = '@longhorn/runtime'

/** The portable boundary between an application and a runtime adapter. */
export type FetchApplication = {
  fetch: (request: Request) => Response | Promise<Response>
}

/** Fetch hosts can supply bindings and a platform execution context per request. */
export type ContextualFetchApplication<Bindings extends object, Context> = {
  fetch(request: Request, bindings?: Bindings | {}, context?: Context): Response | Promise<Response>
}

/** A host can submit non-HTTP root work under the application's startup/drain lifetime. */
export type TaskApplication = {
  run<T>(work: () => T | Promise<T>): Promise<T>
}

export type ServeOptions = {
  hostname?: string
  port?: number
}

export type ServerHandle = {
  readonly hostname: string
  readonly port: number
  readonly url: string
  /** Idempotent: applications can close a listener and later close their whole lifecycle. */
  close(): Promise<void>
}

export type RuntimeAdapter = {
  readonly name: string
  serve(application: FetchApplication, options?: ServeOptions): Promise<ServerHandle>
}

export function resolveServeOptions(options: ServeOptions = {}): Required<ServeOptions> {
  const hostname = options.hostname ?? '127.0.0.1'
  const port = options.port ?? 3000
  if (typeof hostname !== 'string' || !hostname.trim()) throw new Error('Server hostname must not be empty')
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('Server port must be an integer between 0 and 65535')
  return { hostname: hostname.trim(), port }
}
