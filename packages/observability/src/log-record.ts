import type { LogRecord,LogValue } from '@longhorn/logger'
import type { SpanContext } from './tracing.js'

export type LogEntry = { readonly record: LogRecord;readonly observedAt: number;readonly context?: SpanContext }
export class LogRecordError extends Error { constructor(){super('Invalid or oversized log record');this.name='LogRecordError'} }
const encoder=new TextEncoder(),levels=new Set(['debug','info','warn','error'])
function data(object: unknown,key: string): unknown {
  if (!object || typeof object!=='object') throw new LogRecordError()
  const property=Object.getOwnPropertyDescriptor(object,key)
  if (!property || !('value' in property)) throw new LogRecordError()
  return property.value
}
function text(value: unknown): asserts value is string { if(typeof value!=='string'||/[\uD800-\uDFFF]/u.test(value))throw new LogRecordError() }
/** Bounded normalized JSON, without invoking getters/toJSON or retaining the caller's objects. */
export function snapshotLogEntry(input: LogEntry,maximum: number): { entry: LogEntry;bytes: number } {
  try {
    const record=data(input,'record'),timestamp=data(record,'timestamp'),level=data(record,'level'),message=data(record,'message'),fields=data(record,'fields'),observedAt=data(input,'observedAt')
    text(timestamp);text(level);text(message)
    const eventTime=Date.parse(timestamp)
    if (!levels.has(level)||!Number.isSafeInteger(eventTime)||eventTime<0||eventTime>18446744073709||new Date(eventTime).toISOString()!==timestamp||typeof observedAt!=='number'||!Number.isFinite(observedAt)||observedAt<0||observedAt>18446744073709)throw new LogRecordError()
    if (!fields||typeof fields!=='object'||Array.isArray(fields)||Object.getOwnPropertyNames(fields).length>32)throw new LogRecordError()
    const descriptor=Object.getOwnPropertyDescriptor(input,'context');let context: SpanContext|undefined
    if (descriptor && (!('value' in descriptor)||descriptor.value!==undefined)) {
      if (!('value' in descriptor)) throw new LogRecordError()
      const source=descriptor.value,traceId=data(source,'traceId'),spanId=data(source,'spanId'),sampled=data(source,'sampled')
      if(typeof traceId!=='string'||!/^[0-9a-f]{32}$/.test(traceId)||/^0+$/.test(traceId)||typeof spanId!=='string'||!/^[0-9a-f]{16}$/.test(spanId)||/^0+$/.test(spanId)||typeof sampled!=='boolean')throw new LogRecordError()
      context={traceId,spanId,sampled}
    }
    let bytes=0,nodes=0
    const ancestors=new Set<object>()
    const append=(value:string)=>{bytes+=encoder.encode(value).byteLength;if(bytes>maximum)throw new LogRecordError();return value}
    const quoted=(value:unknown)=>{text(value);if(value.length>maximum)throw new LogRecordError();return append(JSON.stringify(value))}
    function visit(value:unknown,depth:number):string{
      if(++nodes>512||depth>10)throw new LogRecordError()
      if(value===null||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return append(JSON.stringify(value))
      if(typeof value==='string')return quoted(value)
      if(!value||typeof value!=='object'||ancestors.has(value))throw new LogRecordError()
      const array=Array.isArray(value),prototype=Object.getPrototypeOf(value)
      if((!array&&prototype!==Object.prototype&&prototype!==null)||Object.getOwnPropertySymbols(value).length)throw new LogRecordError()
      const keys=Object.getOwnPropertyNames(value).filter(key=>!(array&&key==='length'))
      if(keys.length>(array?256:64)||(array&&(keys.length!==value.length||keys.some((key,index)=>key!==String(index)))))throw new LogRecordError()
      ancestors.add(value)
      try{
        const parts=[append(array?'[':'{')]
        for(const[index,key]of(array?keys:keys.sort()).entries()){
          const property=Object.getOwnPropertyDescriptor(value,key)!
          if(!property.enumerable||!('value'in property))throw new LogRecordError()
          if(index)parts.push(append(','))
          if(!array){if(!key||key.length>128)throw new LogRecordError();parts.push(quoted(key),append(':'))}
          parts.push(visit(property.value,depth+1))
        }
        parts.push(append(array?']':'}'));return parts.join('')
      }finally{ancestors.delete(value)}
    }
    const encoded=visit({record:{timestamp,level,message,fields},observedAt,...(context?{context}:{})},0)
    return {entry:JSON.parse(encoded) as LogEntry,bytes}
  }catch{throw new LogRecordError()}
}
export function logAnyValue(value: LogValue): unknown {
  if(value===null)return {}
  if(typeof value==='string')return {stringValue:value}
  if(typeof value==='boolean')return {boolValue:value}
  if(typeof value==='number')return Number.isSafeInteger(value)?{intValue:String(value)}:{doubleValue:value}
  if(Array.isArray(value))return {arrayValue:{values:value.map(logAnyValue)}}
  return {kvlistValue:{values:Object.entries(value).map(([key,value])=>({key,value:logAnyValue(value)}))}}
}
