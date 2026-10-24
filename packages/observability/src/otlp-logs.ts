import type { LogEntry,LogExporter } from './logs.js'
import { snapshotLogEntry,logAnyValue } from './log-record.js'
import { otlpEnvelope,otlpNanos } from './otlp-json.js'
import type { OtlpResource } from './otlp-json.js'
import { OtlpHttpDelivery,OtlpDeliveryError,otlpInteger } from './otlp-delivery.js'
import type { OtlpHttpDeliveryOptions,OtlpFailure } from './otlp-delivery.js'
export { parseOtlpHeaders } from './otlp-delivery.js'
export type { OtlpFailure } from './otlp-delivery.js'
export class OtlpLogExportError extends Error {
  constructor(readonly code:OtlpFailure,readonly statusCode?:number,readonly rejectedLogRecords?:number){super('OTLP log export failed: '+code);this.name='OtlpLogExportError'}
}
export type OtlpHttpLogExporterOptions=OtlpResource&Omit<OtlpHttpDeliveryOptions,'rejectedField'>&{readonly maxLogRecordsPerBatch?:number;readonly maxRecordBytes?:number}
const encoder=new TextEncoder(),severities={debug:5,info:9,warn:13,error:17}
export class OtlpHttpLogExporter implements LogExporter {
  private readonly envelope:ReturnType<typeof otlpEnvelope>
  private readonly delivery:OtlpHttpDelivery
  private readonly maximum:number
  private readonly recordBytes:number
  constructor(options:OtlpHttpLogExporterOptions){
    this.envelope=otlpEnvelope(options,'logs')
    this.maximum=otlpInteger(options.maxLogRecordsPerBatch??128,'maxLogRecordsPerBatch',1,10000)
    this.recordBytes=otlpInteger(options.maxRecordBytes??16384,'maxRecordBytes',1,1048576)
    this.delivery=new OtlpHttpDelivery({...options,rejectedField:'rejectedLogRecords'})
  }
  stats(){const{acceptedItems,rejectedItems,...stats}=this.delivery.stats();return {...stats,acceptedLogRecords:acceptedItems,rejectedLogRecords:rejectedItems}}
  export(entries:readonly LogEntry[]):Promise<void>{
    return this.delivery.export(()=>{
      if(!Array.isArray(entries)||entries.length>this.maximum)throw new RangeError('OTLP log capacity exceeded')
      if(!entries.length)return undefined
      const parts=[this.envelope.prefix];let bytes=encoder.encode(this.envelope.prefix+this.envelope.suffix).byteLength
      for(const[index,input]of entries.entries()){
        const {entry}=snapshotLogEntry(input,this.recordBytes),{record,context}=entry
        const item=JSON.stringify({timeUnixNano:otlpNanos(Date.parse(record.timestamp)),observedTimeUnixNano:otlpNanos(entry.observedAt),severityNumber:severities[record.level],severityText:record.level.toUpperCase(),
          body:{stringValue:record.message},attributes:Object.entries(record.fields).map(([key,value])=>({key,value:logAnyValue(value)})),
          ...(context?{traceId:context.traceId,spanId:context.spanId,flags:context.sampled?1:0}:{})})
        const separator=index?',':'';bytes+=encoder.encode(separator+item).byteLength
        if(bytes>this.delivery.requestBytes)throw new RangeError('OTLP log request size exceeded')
        parts.push(separator,item)
      }
      if(bytes>this.delivery.requestBytes)throw new RangeError('OTLP log request size exceeded')
      return {payload:parts.join('')+this.envelope.suffix,count:entries.length}
    }).catch(error=>{if(error instanceof OtlpDeliveryError)throw new OtlpLogExportError(error.code,error.statusCode,error.rejectedItems);throw new OtlpLogExportError('network')})
  }
  close():Promise<void>{return this.delivery.close()}
}
