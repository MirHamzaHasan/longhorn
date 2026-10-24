import { createJsonClient, JsonClientError } from '@longhorn/http/client'
import type { JsonClientOptions } from '@longhorn/http/client'
import { z } from 'zod'
import { reportSchema } from './reports.js'
import type { ReportInput, ReportResult } from './reports.js'

export const nativeReportProtocol = 'longhorn.reports.v1'
export type NativeReportFailure = 'input' | 'capacity' | 'closed' | 'unavailable' | 'protocol'
export class NativeReportError extends Error {
  constructor(readonly code: NativeReportFailure) { super('Native report operation failed: ' + code); this.name = 'NativeReportError' }
}
export type NativeReportOptions = Pick<JsonClientOptions, 'baseUrl' | 'token' | 'allowInsecureLoopback' | 'timeoutMs' | 'maxConcurrent' | 'fetch'>
const resultSchema = z.object({
  protocol: z.literal(nativeReportProtocol),
  report: z.object({ count: z.number().int().min(1).max(1000), sum: z.number().finite().min(-1e15).max(1e15),
    min: z.number().finite().min(-1e12).max(1e12), max: z.number().finite().min(-1e12).max(1e12) }).strict(),
}).strict()
const healthSchema = z.object({ protocol: z.literal(nativeReportProtocol), status: z.literal('ok') }).strict()

/** Portable HTTP resource: borrows Fetch; owns accepted calls until their actual transport settles. */
export function createNativeReportComputer(options: NativeReportOptions) {
  const maximum = options.maxConcurrent ?? 16
  const client = createJsonClient({ ...options, maxRequestBytes: 65536, maxResponseBytes: 1024 })
  const active = new Set<Promise<void>>()
  let closing: Promise<void> | undefined, accepted = 0, failed = 0
  function accept<T>(work: () => Promise<T>): Promise<T> {
    if (closing) return Promise.reject(new NativeReportError('closed'))
    if (active.size >= maximum) return Promise.reject(new NativeReportError('capacity'))
    accepted++
    const operation = Promise.resolve().then(work).catch(error => {
      failed++
      if (error instanceof NativeReportError) throw error
      if (error instanceof JsonClientError) throw new NativeReportError(error.code === 'capacity' ? 'capacity' : 'unavailable')
      throw new NativeReportError('protocol')
    }).finally(() => active.delete(settled))
    const settled = operation.then(() => {}, () => {})
    active.add(settled); return operation
  }
  return Object.freeze({
    compute(input: ReportInput, signal?: AbortSignal): Promise<ReportResult> {
      // Preflight cardinality before schema work; parsed arrays snapshot before the first await.
      if (!Array.isArray(input?.numbers) || !input.numbers.length || input.numbers.length > 1000) return Promise.reject(new NativeReportError('input'))
      const parsed = reportSchema.safeParse(input)
      if (!parsed.success) return Promise.reject(new NativeReportError('input'))
      return accept(async () => {
        const response = await client.request('v1/reports', { method: 'POST', value: parsed.data, ...(signal ? { signal } : {}) })
        if (response.status !== 200) throw new NativeReportError('unavailable')
        const decoded = resultSchema.safeParse(response.data)
        if (!decoded.success || decoded.data.report.count !== parsed.data.numbers.length || decoded.data.report.min > decoded.data.report.max) throw new NativeReportError('protocol')
        return Object.freeze({ ...decoded.data.report })
      })
    },
    healthy(signal?: AbortSignal): Promise<boolean> {
      return accept(async () => {
        const response = await client.request('health', signal ? { signal } : {})
        return response.status === 200 && healthSchema.safeParse(response.data).success
      }).catch(error => { if (error instanceof NativeReportError && error.code === 'unavailable') return false; throw error })
    },
    stats: () => ({ active: active.size, accepted, failed, closing: closing !== undefined }),
    close() { return closing ??= (async () => { while (active.size) await Promise.all([...active]) })() },
  })
}
