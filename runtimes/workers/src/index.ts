import type { ExecutionContext } from '@cloudflare/workers-types'
import type { ContextualFetchApplication } from '@longhorn/runtime'

export const PACKAGE_NAME = '@longhorn/workers'
export type WorkerExecutionContext = Pick<ExecutionContext, 'waitUntil' | 'passThroughOnException' | 'props'>
export type WorkerHandler<Bindings extends object> = {
  fetch(request: Request, bindings: Bindings, context: WorkerExecutionContext): Promise<Response>
}

/** The platform owns the listener and isolate. Do not close shared apps after each request. */
export function createWorker<Bindings extends object>(
  application: ContextualFetchApplication<Bindings, WorkerExecutionContext>,
): WorkerHandler<Bindings> {
  return {
    fetch: async (request, bindings, context) => application.fetch(request, bindings, context),
  }
}

export type { ExecutionContext } from '@cloudflare/workers-types'
