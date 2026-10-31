import { Container } from '@longhornjs/container'
import { createHttpApp } from '@longhornjs/http'
import type { Hono } from '@longhornjs/http'
import type { RuntimeAdapter, ServerHandle, ServeOptions } from '@longhornjs/runtime'
import type { RuntimeTarget } from './runtime.js'
import { Lifecycle } from './lifecycle.js'
import type { LifecycleState, StartHook, StopHook } from './lifecycle.js'
import { createLogger } from '@longhornjs/logger'
import type { Logger } from '@longhornjs/logger'
import { requestLogger } from '@longhornjs/logger/hono'

export type LonghornOptions = { logger?: Logger }

export type LonghornEnv<Bindings extends object = Record<string, unknown>> = {
  Bindings: Bindings
  Variables: { container: Container; logger: Logger; requestId: string }
}

export class Longhorn<Bindings extends object = Record<string, unknown>> {
  readonly container = new Container()
  readonly logger: Logger
  readonly http: Hono<LonghornEnv<Bindings>>
  readonly fetch: Hono<LonghornEnv<Bindings>>['fetch']
  private readonly runtimes = new Map<string, Readonly<RuntimeTarget>>()
  private readonly lifecycle = new Lifecycle()
  private readonly servers = new Set<ServerHandle>()
  private readonly pendingServers = new Set<Promise<ServerHandle>>()
  private readonly requests = new Set<Promise<Response>>()
  private readonly tasks = new Set<Promise<unknown>>()
  private closing: Promise<void> | undefined

  constructor(options: LonghornOptions = {}) {
    this.logger = options.logger ?? createLogger({ level: 'silent' })
    this.http = createHttpApp<LonghornEnv<Bindings>>({
      onError: (error, c) => (c.get('logger') ?? this.logger).error('HTTP request failed', { error }),
    })
    this.http.use('*', requestLogger(this.logger))
    this.http.use('*', async (c, next) => {
      c.set('container', this.container)
      await next()
    })
    this.fetch = async (...args) => {
      await this.start()
      if (this.closing) throw new Error('Cannot dispatch a request on a closing application')
      const request = Promise.resolve().then(() => this.http.fetch(...args))
      this.requests.add(request)
      try { return await request } finally { this.requests.delete(request) }
    }
  }

  get state(): LifecycleState {
    return this.closing && this.lifecycle.state !== 'stopped' && this.lifecycle.state !== 'failed'
      ? 'stopping' : this.lifecycle.state
  }

  onStart(hook: StartHook): this {
    if (this.closing) throw new Error('Lifecycle hooks must be registered before the application starts')
    this.lifecycle.onStart(hook)
    return this
  }

  onStop(hook: StopHook): this {
    if (this.closing) throw new Error('Lifecycle hooks must be registered before the application starts')
    this.lifecycle.onStop(hook)
    return this
  }

  start(): Promise<void> {
    if (this.closing) return Promise.reject(new Error('Cannot start a closing or closed application'))
    return this.lifecycle.start()
  }

  /** Managed non-HTTP work. Await descendants; closing drains the actual callback promise. */
  async run<T>(work: () => T | Promise<T>): Promise<T> {
    await this.start()
    if (this.closing) throw new Error('Cannot dispatch work on a closing application')
    const pending = Promise.resolve().then(work)
    this.tasks.add(pending)
    try { return await pending } finally { this.tasks.delete(pending) }
  }

  async listen(adapter: RuntimeAdapter, options?: ServeOptions): Promise<ServerHandle> {
    await this.start()
    if (this.closing) throw new Error('Cannot listen on a closing application')
    const opening = Promise.resolve().then(() => adapter.serve(this, options))
    this.pendingServers.add(opening)
    try {
      const server = await opening
      this.servers.add(server)
      if (this.closing) throw new Error('Application closed while the server was starting')
      return server
    } catch (error) {
      this.pendingServers.delete(opening)
      if (!this.closing && !this.servers.size && !this.pendingServers.size) {
        try { await this.close() } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'Server startup and cleanup failed', { cause: error })
        }
      }
      throw error
    } finally {
      this.pendingServers.delete(opening)
    }
  }

  close(): Promise<void> {
    this.closing ??= this.shutdown()
    return this.closing
  }

  private async shutdown(): Promise<void> {
    await Promise.allSettled([...this.pendingServers])
    const errors: unknown[] = []
    for (const server of [...this.servers].reverse()) {
      try { await server.close() } catch (error) { errors.push(error) }
    }
    this.servers.clear()
    await Promise.allSettled([...this.requests, ...this.tasks])
    try { await this.lifecycle.stop() } catch (error) { errors.push(error) }
    if (errors.length) throw new AggregateError(errors, 'Application shutdown failed')
  }

  runtime(target: RuntimeTarget): this {
    const name = target.name.trim()
    const adapter = target.adapter.trim()

    if (!name) throw new Error('Runtime target name must not be empty')
    if (!adapter) throw new Error(`Runtime target "${name}" must specify an adapter`)
    if (this.runtimes.has(name)) {
      throw new Error(`Runtime target "${name}" already exists`)
    }

    this.runtimes.set(name, Object.freeze({ name, adapter }))
    return this
  }

  getRuntime(name: string): Readonly<RuntimeTarget> | undefined {
    return this.runtimes.get(name)
  }

  getRuntimes(): Readonly<RuntimeTarget>[] {
    return [...this.runtimes.values()]
  }
}
