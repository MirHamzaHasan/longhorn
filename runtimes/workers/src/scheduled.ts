import type { ScheduledController } from '@cloudflare/workers-types'
import type { ContextualFetchApplication,TaskApplication } from '@longhornjs/runtime'
import { createWorker } from './index.js'
import type { WorkerExecutionContext,WorkerHandler } from './index.js'

export type WorkerScheduledController = Pick<ScheduledController,'scheduledTime' | 'cron' | 'noRetry'>
export type ScheduledInvocation<Bindings extends object> = {
  readonly controller: WorkerScheduledController
  readonly bindings: Bindings
  readonly context: WorkerExecutionContext
  /** Cooperative budget only. The invocation retains its slot/resources until the callback settles. */
  readonly signal: AbortSignal
}
export type ScheduledWorkerOptions<Bindings extends object> = {
  readonly handle: (invocation: ScheduledInvocation<Bindings>) => void | Promise<void>
  readonly maxConcurrent?: number
  readonly timeoutMs?: number
}
export class ScheduledCapacityError extends Error { constructor() { super('Scheduled invocation capacity exceeded');this.name='ScheduledCapacityError' } }
export class ScheduledClosedError extends Error { constructor() { super('Scheduled adapter is closing or closed');this.name='ScheduledClosedError' } }
export class ScheduledInputError extends Error { constructor() { super('Invalid scheduled controller metadata');this.name='ScheduledInputError' } }
export class ScheduledTimeoutError extends Error { constructor() { super('Scheduled invocation budget exceeded');this.name='ScheduledTimeoutError' } }
export type ScheduledWorker<Bindings extends object> = WorkerHandler<Bindings> & {
  scheduled(controller: WorkerScheduledController,bindings: Bindings,context: WorkerExecutionContext): Promise<void>
  /** Stop scheduled admission/drain only. Does not close the application or Fetch adapter. */
  close(): Promise<void>
  stats(): { readonly active: number;readonly succeeded: number;readonly failed: number;readonly rejected: number;readonly timedOut: number;readonly closing: boolean;readonly closed: boolean }
}

/** Platform-trigger adapter; no polling timer, persistent queue, retry policy or per-event app shutdown. */
export function createScheduledWorker<Bindings extends object>(
  application: ContextualFetchApplication<Bindings,WorkerExecutionContext> & TaskApplication,
  options: ScheduledWorkerOptions<Bindings>,
): ScheduledWorker<Bindings> {
  const maximum=options.maxConcurrent ?? 1,timeout=options.timeoutMs ?? 30000,handle=options.handle
  if (!Number.isSafeInteger(maximum) || maximum<1 || maximum>64) throw new Error('Invalid scheduled maxConcurrent')
  if (!Number.isSafeInteger(timeout) || timeout<1 || timeout>900000) throw new Error('Invalid scheduled timeoutMs')
  if (typeof handle!=='function') throw new Error('Scheduled handler is required')
  const active=new Set<Promise<void>>()
  let closing: Promise<void> | undefined,closed=false,succeeded=0,failed=0,rejected=0,timedOut=0
  const registerFailure=(context: WorkerExecutionContext,error: unknown): Promise<void> => {
    rejected++
    const result=Promise.reject<void>(error)
    try { context.waitUntil(result) } catch (registrationError) { void result.catch(() => {});return Promise.reject(registrationError) }
    return result
  }
  return {
    ...createWorker(application),
    scheduled(controller,bindings,context) {
      if (closing) return registerFailure(context,new ScheduledClosedError())
      if (active.size>=maximum) return registerFailure(context,new ScheduledCapacityError())
      try {
        if (!controller || !Number.isSafeInteger(controller.scheduledTime) || controller.scheduledTime<0 || controller.scheduledTime>8_640_000_000_000_000 ||
          typeof controller.cron!=='string' || controller.cron.length>512 || /[\x00-\x1f\x7f]/.test(controller.cron) || typeof controller.noRetry!=='function') throw new ScheduledInputError()
      } catch (error) { return registerFailure(context,error) }
      const cancellation=new AbortController()
      const timer=setTimeout(() => { timedOut++;cancellation.abort(new ScheduledTimeoutError()) },timeout)
      let registrationFailure: { error: unknown } | undefined
      // Register before any user/startup work runs; preserve method ownership and the exact returned promise.
      const operation=Promise.resolve().then(() => {
        if (registrationFailure) throw registrationFailure.error
        return application.run(async () => {
          cancellation.signal.throwIfAborted()
          await handle({ controller,bindings,context,signal: cancellation.signal })
          cancellation.signal.throwIfAborted()
        })
      }).then(() => { succeeded++ },error => { failed++;throw error }).finally(() => { clearTimeout(timer);active.delete(settled) })
      const settled=operation.then(() => {},() => {})
      active.add(settled)
      try { context.waitUntil(operation) } catch (error) { registrationFailure={ error } }
      return operation
    },
    close() { closing ??= Promise.all([...active]).then(() => { closed=true });return closing },
    stats: () => ({ active: active.size,succeeded,failed,rejected,timedOut,closing: closing!==undefined,closed }),
  }
}
