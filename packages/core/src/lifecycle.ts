export type StopHook = () => void | Promise<void>
export type StartHook = () => void | StopHook | Promise<void | StopHook>
export type LifecycleState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'

/** One lifecycle per application. Runtime signals belong in the host adapter/application. */
export class Lifecycle {
  private current: LifecycleState = 'idle'
  private readonly starts: StartHook[] = []
  private readonly stops: StopHook[] = []
  private readonly resources: StopHook[] = []
  private starting: Promise<void> | undefined
  private stopping: Promise<void> | undefined

  get state(): LifecycleState { return this.current }

  onStart(hook: StartHook): void {
    this.assertConfigurable()
    this.starts.push(hook)
  }

  onStop(hook: StopHook): void {
    this.assertConfigurable()
    this.stops.push(hook)
  }

  start(): Promise<void> {
    if (this.stopping || this.current === 'failed') {
      return Promise.reject(new Error(`Cannot start an application that is ${this.current}`))
    }
    if (this.starting) return this.starting
    this.current = 'starting'
    this.starting = this.runStart()
    return this.starting
  }

  stop(): Promise<void> {
    this.stopping ??= this.runStop()
    return this.stopping
  }

  private assertConfigurable(): void {
    if (this.current !== 'idle' || this.stopping) {
      throw new Error('Lifecycle hooks must be registered before the application starts')
    }
  }

  private async runStart(): Promise<void> {
    try {
      for (const hook of this.starts) {
        const cleanup = await hook()
        if (cleanup) this.resources.push(cleanup)
      }
      this.current = 'running'
    } catch (error) {
      const cleanupErrors = await this.cleanup()
      this.current = 'failed'
      if (cleanupErrors.length) {
        throw new AggregateError([error, ...cleanupErrors], 'Application startup and cleanup failed', { cause: error })
      }
      throw error
    }
  }

  private async runStop(): Promise<void> {
    try {
      await this.starting
    } catch {
      // Failed startup has already rolled back acquired resources.
      return
    }
    this.current = 'stopping'
    const errors = await this.cleanup()
    this.current = 'stopped'
    if (errors.length) throw new AggregateError(errors, 'Application cleanup failed')
  }

  private async cleanup(): Promise<unknown[]> {
    const errors: unknown[] = []
    const hooks = [...this.resources.reverse(), ...this.stops.reverse()]
    this.resources.length = 0
    this.stops.length = 0
    for (const hook of hooks) {
      try { await hook() } catch (error) { errors.push(error) }
    }
    return errors
  }
}
