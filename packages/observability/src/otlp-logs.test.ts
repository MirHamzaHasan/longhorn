import { expect,it,vi } from 'vitest'
import { createLogger } from '@longhornjs/logger'
import { OtlpHttpLogExporter,OtlpLogExportError } from './otlp-logs.js'
import type { OtlpHttpLogExporterOptions } from './otlp-logs.js'
import type { LogEntry } from './logs.js'
const ok=(value:unknown={})=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}})
const options=(fetch:typeof globalThis.fetch,extra:Partial<OtlpHttpLogExporterOptions>={})=>({endpoint:'http://127.0.0.1:4318/v1/logs',serviceName:'logs-test',fetch,initialRetryDelayMs:1,maxRetryDelayMs:4,...extra})
function entry():LogEntry{return {record:{timestamp:'2026-10-23T12:00:00.000Z',level:'info',message:'completed',fields:{integer:42,fraction:1.5,yes:true,nothing:null,array:[1,'雪😀',null],object:{status:'ok'}}},observedAt:1792760000010.25,context:{traceId:'1'.repeat(32),spanId:'2'.repeat(16),sampled:true}}}
it('encodes event/observed nanos, severities, recursive typed fields, explicit correlation and frozen bytes',async()=>{
  let body='',authorization='';const headers={authorization:'Bearer private'}
  const exporter=new OtlpHttpLogExporter(options(async(_url,init)=>{body=String(init!.body);authorization=new Headers(init!.headers).get('authorization')!;return ok()},{headers}))
  const input=entry(),pending=exporter.export([input]);headers.authorization='changed';(input.record.fields as {integer:number}).integer=99;await pending
  const wire=JSON.parse(body).resourceLogs[0].scopeLogs[0].logRecords[0]
  expect(wire).toMatchObject({severityNumber:9,severityText:'info',body:{stringValue:'completed'},timeUnixNano:'1792756800000000000',observedTimeUnixNano:'1792760000010250000',traceId:'1'.repeat(32),spanId:'2'.repeat(16),flags:1})
  expect(wire.attributes).toContainEqual({key:'integer',value:{intValue:'42'}});expect(wire.attributes).toContainEqual({key:'fraction',value:{doubleValue:1.5}})
  expect(wire.attributes).toContainEqual({key:'array',value:{arrayValue:{values:[{intValue:'1'},{stringValue:'雪😀'},{}]}}})
  expect(wire.attributes).toContainEqual({key:'object',value:{kvlistValue:{values:[{key:'status',value:{stringValue:'ok'}}]}}})
  expect(authorization).toBe('Bearer private');expect(exporter.stats().acceptedLogRecords).toBe(1);await exporter.close()
})
it('preserves logger filtering/redaction and maps all four levels without inventing context',async()=>{
  const entries:LogEntry[]=[],logger=createLogger({level:'debug',sink:record=>entries.push({record,observedAt:Date.now()}),clock:()=>new Date(1792760000000)})
  logger.debug('d');logger.info('i');logger.warn('w');logger.error('e',{password:'private'})
  let body='';const exporter=new OtlpHttpLogExporter(options(async(_url,init)=>{body=String(init!.body);return ok()}));await exporter.export(entries)
  const records=JSON.parse(body).resourceLogs[0].scopeLogs[0].logRecords;expect(records.map((r:{severityNumber:number})=>r.severityNumber)).toEqual([5,9,13,17])
  expect(records[3].attributes).toContainEqual({key:'password',value:{stringValue:'[Redacted]'}});expect(body).not.toContain('private');expect(records[0]).not.toHaveProperty('traceId');await exporter.close()
})
it('checks record schema, UTF-8/encoded byte caps, batch count and context before sending',async()=>{
  const send=vi.fn(async()=>ok()),exporter=new OtlpHttpLogExporter(options(send,{maxRequestBytes:256,maxLogRecordsPerBatch:1}))
  await exporter.export([]);await expect(exporter.export([entry(),entry()])).rejects.toMatchObject({code:'request-too-large'})
  await expect(exporter.export([entry()])).rejects.toMatchObject({code:'request-too-large'})
  const normal=new OtlpHttpLogExporter(options(send))
  await expect(normal.export([{...entry(),context:{traceId:'0'.repeat(32),spanId:'2'.repeat(16),sampled:true}}])).rejects.toMatchObject({code:'invalid-input'})
  await expect(normal.export([{...entry(),observedAt:Infinity}])).rejects.toMatchObject({code:'invalid-input'})
  expect(send).not.toHaveBeenCalled();await exporter.close();await normal.close()
})
it('uses log-specific partial counts without retry or collector diagnostic disclosure',async()=>{
  const send=vi.fn(async()=>ok({partialSuccess:{rejectedLogRecords:'1',errorMessage:'private rejection'}})),exporter=new OtlpHttpLogExporter(options(send))
  const error=await exporter.export([entry(),entry()]).catch(error=>error);expect(error).toBeInstanceOf(OtlpLogExportError);expect(error).toMatchObject({code:'partial',rejectedLogRecords:1})
  expect(exporter.stats()).toMatchObject({acceptedLogRecords:1,rejectedLogRecords:1,failedBatches:1,partialResponses:1,warnings:1});expect(send).toHaveBeenCalledTimes(1);expect(String(error)+JSON.stringify(error)).not.toContain('private');await exporter.close()
})
it('retries transient failure with the exact payload, quarantines a timed-out custom fetch and closes once',async()=>{
  const bodies:string[]=[],exporter=new OtlpHttpLogExporter(options(async(_url,init)=>{bodies.push(String(init!.body));return bodies.length===1?new Response('',{status:503}):ok()}))
  await exporter.export([entry()]);expect(new Set(bodies).size).toBe(1);expect(exporter.stats().retries).toBe(1);await exporter.close()
  let release!:(value:Response)=>void;const stalled=new OtlpHttpLogExporter(options(async()=>new Promise<Response>(resolve=>{release=resolve}),{timeoutMs:15}))
  await expect(stalled.export([entry()])).rejects.toMatchObject({code:'timeout'});await expect(stalled.export([entry()])).rejects.toMatchObject({code:'busy'})
  const closing=stalled.close();expect(stalled.close()).toBe(closing);await closing;release(ok());await vi.waitFor(()=>expect(stalled.stats().pendingTransports).toBe(0));expect(stalled.stats().acceptedLogRecords).toBe(0)
})
it('counts actual UTF-8 request bytes and validates log-specific acknowledgement ranges and warnings',async()=>{
  let payload='';const input=entry();(input.record as {message:string}).message='雪😀'.repeat(64)
  const first=new OtlpHttpLogExporter(options(async(_url,init)=>{payload=String(init!.body);return ok()}));await first.export([input]);await first.close()
  const send=vi.fn(async()=>ok()),bounded=new OtlpHttpLogExporter(options(send,{maxRequestBytes:payload.length}))
  await expect(bounded.export([input])).rejects.toMatchObject({code:'request-too-large'});expect(send).not.toHaveBeenCalled();await bounded.close()
  for(const value of['2',-1,'not-a-count']){
    const send=vi.fn(async()=>ok({partialSuccess:{rejectedLogRecords:value}})),exporter=new OtlpHttpLogExporter(options(send))
    await expect(exporter.export([entry()])).rejects.toMatchObject({code:'protocol'});expect(send).toHaveBeenCalledTimes(1);await exporter.close()
  }
  const warning=new OtlpHttpLogExporter(options(async()=>ok({partialSuccess:{rejectedLogRecords:0,errorMessage:'private warning'}})))
  await warning.export([entry()]);expect(warning.stats()).toMatchObject({acceptedLogRecords:1,warnings:1,failedBatches:0});await warning.close()
})
