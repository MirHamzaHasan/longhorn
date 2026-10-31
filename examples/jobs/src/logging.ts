import { createLogger,consoleLogSink,fanoutLogSinks } from '@longhornjs/logger'
import type { LogRecord,LogSink } from '@longhornjs/logger'
import { BufferedLogProcessor } from '@longhornjs/observability'
import type { LogExporter,SpanContext } from '@longhornjs/observability'
import { OtlpHttpLogExporter } from '@longhornjs/observability/otlp-logs'
import type { AppConfig } from './config.js'

const remoteFields=new Set(['app','method','status','durationMs','traceId','spanId','traceSampled','component','operation'])
/** The demo exports an explicit metadata projection; local console records remain complete. */
function remoteRecord(record:LogRecord):LogRecord{return {...record,fields:Object.fromEntries(Object.entries(record.fields).filter(([key])=>remoteFields.has(key)))}}
function context(record:LogRecord):SpanContext|undefined{
  const {traceId,spanId,traceSampled}=record.fields
  if(typeof traceId!=='string'||!/^[0-9a-f]{32}$/.test(traceId)||/^0+$/.test(traceId)||typeof spanId!=='string'||!/^[0-9a-f]{16}$/.test(spanId)||/^0+$/.test(spanId)||typeof traceSampled!=='boolean')return undefined
  return {traceId,spanId,sampled:traceSampled}
}
export function createJobsLogging(config:AppConfig,resources:{exporter?:LogExporter;localSink?:LogSink}={}){
  const localSink=resources.localSink??consoleLogSink
  const local=createLogger({level:config.logLevel,bindings:{app:'jobs-example'},sink:localSink})
  const exporter=resources.exporter??(config.otlpLogs?new OtlpHttpLogExporter(config.otlpLogs):undefined)
  const processor=exporter?new BufferedLogProcessor({exporter,onError:error=>local.warn('Log export failed',{component:'logs',operation:error.operation})}):undefined
  const sink=processor?fanoutLogSinks([localSink,record=>processor.emit(remoteRecord(record),context(record))]):localSink
  return {logger:createLogger({level:config.logLevel,bindings:{app:'jobs-example'},sink}),processor}
}
