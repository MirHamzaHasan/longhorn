import type { SpanExporter,SpanRecord } from './tracing.js'
import { otlpEnvelope,otlpJson } from './otlp-json.js'
import type { OtlpResource } from './otlp-json.js'
import { OtlpHttpDelivery,OtlpDeliveryError,otlpInteger } from './otlp-delivery.js'
import type { OtlpHttpDeliveryOptions,OtlpFailure } from './otlp-delivery.js'
export { parseOtlpHeaders } from './otlp-delivery.js'
export type { OtlpFailure } from './otlp-delivery.js'

export class OtlpExportError extends Error {
  constructor(readonly code: OtlpFailure,readonly statusCode?: number,readonly rejectedSpans?: number) {
    super(`OTLP export failed: ${code}`);this.name='OtlpExportError'
  }
}
export type OtlpHttpExporterOptions = OtlpResource & Omit<OtlpHttpDeliveryOptions,'rejectedField'> & {
  readonly maxSpansPerBatch?: number
}
/** One bounded in-flight export; Tracer owns batching/queueing and exclusive exporter lifetime. */
export class OtlpHttpSpanExporter implements SpanExporter {
  private readonly envelope: ReturnType<typeof otlpEnvelope>
  private readonly delivery: OtlpHttpDelivery
  private readonly maximum: number
  constructor(options: OtlpHttpExporterOptions) {
    this.envelope=otlpEnvelope(options)
    this.maximum=otlpInteger(options.maxSpansPerBatch ?? 256,'maxSpansPerBatch',1,10000)
    this.delivery=new OtlpHttpDelivery({ ...options,rejectedField: 'rejectedSpans' })
  }
  stats() {
    const { acceptedItems,rejectedItems,...stats }=this.delivery.stats()
    return { ...stats,acceptedSpans: acceptedItems,rejectedSpans: rejectedItems }
  }
  export(spans: readonly SpanRecord[]): Promise<void> {
    return this.delivery.export(() => {
      if (!Array.isArray(spans) || spans.length>this.maximum) throw new RangeError('OTLP span capacity exceeded')
      if (!spans.length) return undefined
      return { payload: otlpJson(spans,this.envelope,this.delivery.requestBytes),count: spans.length }
    }).catch(error => {
      if (error instanceof OtlpDeliveryError) throw new OtlpExportError(error.code,error.statusCode,error.rejectedItems)
      throw new OtlpExportError('network')
    })
  }
  close(): Promise<void> { return this.delivery.close() }
}
