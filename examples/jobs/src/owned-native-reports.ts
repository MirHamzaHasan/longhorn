import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'
import { startProcess } from '@longhorn/node/process'
import { createNativeReportComputer, NativeReportError, nativeReportProtocol } from './native-reports.js'
import type { ReportComputerResource } from './reports.js'

export type OwnedNativeReportOptions = {
  readonly executable: string
  readonly signal?: AbortSignal
  readonly startupTimeoutMs?: number
  readonly shutdownTimeoutMs?: number
  readonly timeoutMs?: number
}
/** Node host resource. Shared report callers retain the same portable compute function. */
export async function openOwnedNativeReports(options: OwnedNativeReportOptions) {
  const token = randomBytes(32).toString('hex')
  const child = await startProcess({
    executable: options.executable, cwd: dirname(options.executable),
    env: { LONGHORN_NATIVE_TOKEN: token, LONGHORN_NATIVE_HOST: '127.0.0.1', LONGHORN_NATIVE_PORT: '0' },
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.startupTimeoutMs === undefined ? {} : { startupTimeoutMs: options.startupTimeoutMs }),
    ...(options.shutdownTimeoutMs === undefined ? {} : { shutdownTimeoutMs: options.shutdownTimeoutMs }),
    ready(line) {
      const record = JSON.parse(line) as Record<string, unknown>
      if (record.message !== 'Native reports listening') return undefined
      if (record.protocol !== nativeReportProtocol || typeof record.url !== 'string') throw new Error('Invalid native readiness')
      const url = new URL(record.url)
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !url.port) throw new Error('Invalid native address')
      return Object.freeze({ baseUrl: url.origin + '/' })
    },
  })
  let client: ReturnType<typeof createNativeReportComputer> | undefined
  try {
    client = createNativeReportComputer({ baseUrl: child.value.baseUrl, token, allowInsecureLoopback: true, timeoutMs: options.timeoutMs ?? 2000 })
    if (!await client.healthy(options.signal) || child.state !== 'running') throw new NativeReportError('unavailable')
    const connection = client
    let closing: Promise<void> | undefined
    const resource: ReportComputerResource & { readonly pid: number; readonly exited: typeof child.exited; readonly baseUrl: string } = Object.freeze({
      pid: child.pid, exited: child.exited, baseUrl: child.value.baseUrl,
      compute(input, signal) {
        if (child.state !== 'running') return Promise.reject(new NativeReportError('unavailable'))
        return connection.compute(input, signal)
      },
      healthy(signal) { return child.state === 'running' ? connection.healthy(signal) : Promise.resolve(false) },
      close() {
        return closing ??= (async () => {
          const errors: unknown[] = []
          for (const resource of [connection, child]) try { await resource.close() } catch (error) { errors.push(error) }
          if (errors.length) throw new AggregateError(errors, 'Owned native report cleanup failed')
        })()
      },
    })
    return resource
  } catch (error) {
    const errors = [error]
    for (const resource of [client, child]) try { await resource?.close() } catch (closeError) { errors.push(closeError) }
    if (errors.length > 1) throw new AggregateError(errors, 'Owned native report startup and cleanup failed')
    throw error
  }
}
