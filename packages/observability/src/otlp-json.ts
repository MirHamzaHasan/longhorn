import type { Attributes,SpanRecord } from './tracing.js'

export type OtlpResource = { readonly serviceName: string;readonly serviceVersion?: string;readonly resourceAttributes?: Attributes }
const encoder=new TextEncoder(),uint64=18_446_744_073_709_551_615n
function text(value: unknown): asserts value is string {
  if (typeof value!=='string' || !value || value.length>256 || /[\x00-\x1f\x7f]/.test(value) || /[\uD800-\uDFFF]/u.test(value)) throw new Error('Invalid OTLP text')
}
function attributes(input: Attributes) {
  const entries=Object.entries(input)
  if (entries.length>32) throw new Error('OTLP attribute capacity exceeded')
  return entries.map(([key,value]) => {
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key)) throw new Error('Invalid OTLP attribute name')
    if (typeof value==='string' && value.length<=256 && !/[\uD800-\uDFFF]/u.test(value)) return { key,value: { stringValue: value } }
    if (typeof value==='boolean') return { key,value: { boolValue: value } }
    if (typeof value==='number' && Number.isFinite(value)) return { key,value: Number.isSafeInteger(value) ? { intValue: String(value) } : { doubleValue: value } }
    throw new Error('Invalid OTLP attribute value')
  })
}
function id(value: unknown,bytes: number): asserts value is string {
  if (typeof value!=='string' || !new RegExp(`^[0-9a-f]{${bytes*2}}$`).test(value) || /^0+$/.test(value)) throw new Error('Invalid OTLP identifier')
}
export function otlpNanos(value: number): string {
  if (!Number.isFinite(value) || value<0 || !Number.isSafeInteger(Math.trunc(value))) throw new Error('Invalid OTLP timestamp')
  const result=BigInt(Math.trunc(value))*1_000_000n+BigInt(Math.round((value-Math.trunc(value))*1_000_000))
  if (result>uint64) throw new Error('OTLP timestamp outside uint64 range')
  return result.toString()
}
function span(input: SpanRecord) {
  text(input.name);id(input.context.traceId,16);id(input.context.spanId,8)
  if (typeof input.context.sampled!=='boolean' || input.endedAt<input.startedAt) throw new Error('Invalid OTLP span')
  if (input.parentSpanId!==null) id(input.parentSpanId,8)
  const kinds={ internal: 1,server: 2,producer: 4,consumer: 5 },statuses={ unset: 0,ok: 1,error: 2 }
  if (!Object.hasOwn(kinds,input.kind) || !Object.hasOwn(statuses,input.status)) throw new Error('Invalid OTLP enum')
  return { traceId: input.context.traceId,spanId: input.context.spanId,...(input.parentSpanId===null ? {} : { parentSpanId: input.parentSpanId }),
    name: input.name,kind: kinds[input.kind],flags: input.context.sampled ? 1 : 0,
    startTimeUnixNano: otlpNanos(input.startedAt),endTimeUnixNano: otlpNanos(input.endedAt),attributes: attributes(input.attributes),status: { code: statuses[input.status] } }
}
/** Snapshot resource metadata once. Only the bounded serialized envelope is retained. */
export function otlpEnvelope(resource: OtlpResource,signal: 'traces' | 'metrics' | 'logs' = 'traces'): { prefix: string;suffix: string } {
  text(resource.serviceName)
  if (resource.serviceVersion!==undefined) text(resource.serviceVersion)
  const extra=resource.resourceAttributes ?? {}
  if (Object.hasOwn(extra,'service.name') || Object.hasOwn(extra,'service.version')) throw new Error('Reserved OTLP resource attribute')
  const resourceAttributes=attributes({ ...extra,'service.name': resource.serviceName,...(resource.serviceVersion===undefined ? {} : { 'service.version': resource.serviceVersion }) })
  const [resources,scopes,items]=signal==='logs' ? ['resourceLogs','scopeLogs','logRecords'] : signal==='metrics' ? ['resourceMetrics','scopeMetrics','metrics'] : ['resourceSpans','scopeSpans','spans']
  return { prefix: `{"${resources}":[{"resource":{"attributes":${JSON.stringify(resourceAttributes)}},"${scopes}":[{"scope":{"name":"@longhorn/observability","version":"0.0.1"},"${items}":[`,suffix: ']}]}]}' }
}
/** Incremental byte accounting rejects oversized batches before serializing the remaining spans. */
export function otlpJson(spans: readonly SpanRecord[],envelope: ReturnType<typeof otlpEnvelope>,maxBytes: number): string {
  let bytes=encoder.encode(envelope.prefix+envelope.suffix).byteLength
  const parts=[envelope.prefix]
  for (const input of spans) {
    const item=JSON.stringify(span(input)),separator=parts.length===1 ? '' : ','
    bytes+=encoder.encode(separator+item).byteLength
    if (bytes>maxBytes) throw new RangeError('OTLP request size exceeded')
    parts.push(separator,item)
  }
  if (bytes>maxBytes) throw new RangeError('OTLP request size exceeded')
  return parts.join('')+envelope.suffix
}
