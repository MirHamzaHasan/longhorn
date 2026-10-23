import type { MetricCollection,MetricExporter } from './metrics.js'
import { otlpEnvelope } from './otlp-json.js'
import type { OtlpResource } from './otlp-json.js'
import { otlpMetricsJson } from './otlp-metrics-json.js'
import { OtlpHttpDelivery,OtlpDeliveryError,otlpInteger } from './otlp-delivery.js'
import type { OtlpHttpDeliveryOptions,OtlpFailure } from './otlp-delivery.js'
export { parseOtlpHeaders } from './otlp-delivery.js'
export type { OtlpFailure } from './otlp-delivery.js'

export class OtlpMetricExportError extends Error {
  constructor(readonly code: OtlpFailure,readonly statusCode?: number,readonly rejectedDataPoints?: number) {
    super(`OTLP metrics export failed: ${code}`);this.name='OtlpMetricExportError'
  }
}
export type OtlpHttpMetricExporterOptions = OtlpResource & Omit<OtlpHttpDeliveryOptions,'rejectedField'> & {
  readonly maxDataPointsPerBatch?: number
}
/** One bounded cumulative export; a reader owns collection, batching and lifetime. */
export class OtlpHttpMetricExporter implements MetricExporter {
  private readonly envelope: ReturnType<typeof otlpEnvelope>
  private readonly delivery: OtlpHttpDelivery
  private readonly maximum: number
  constructor(options: OtlpHttpMetricExporterOptions) {
    this.envelope=otlpEnvelope(options,'metrics')
    this.maximum=otlpInteger(options.maxDataPointsPerBatch ?? 1000,'maxDataPointsPerBatch',1,10000)
    this.delivery=new OtlpHttpDelivery({ ...options,rejectedField: 'rejectedDataPoints' })
  }
  stats() {
    const { acceptedItems,rejectedItems,...stats }=this.delivery.stats()
    return { ...stats,acceptedDataPoints: acceptedItems,rejectedDataPoints: rejectedItems }
  }
  export(collection: MetricCollection): Promise<void> {
    return this.delivery.export(() => otlpMetricsJson(collection,this.envelope,this.delivery.requestBytes,this.maximum)).catch(error => {
      if (error instanceof OtlpDeliveryError) throw new OtlpMetricExportError(error.code,error.statusCode,error.rejectedItems)
      throw new OtlpMetricExportError('network')
    })
  }
  close(): Promise<void> { return this.delivery.close() }
}
