import { expect,it,vi } from 'vitest'
import { createLogger } from '@longhorn/logger'
import type { LogRecord } from '@longhorn/logger'
import { BufferedLogProcessor } from './logs.js'
import type { LogEntry } from './logs.js'
const record=(message='event'):LogRecord=>({timestamp:'2026-10-23T12:00:00.000Z',level:'info',message,fields:{value:1}})
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve});return {promise,release}}
it('keeps logging synchronous, snapshots normalized entries and drains serial count/byte batches once',async()=>{
  const blocked=gate(),batches:LogEntry[][]=[],close=vi.fn(async()=>{})
  const processor=new BufferedLogProcessor({exporter:{export:async entries=>{batches.push([...entries]);if(batches.length===1)await blocked.promise},close},maxBatchRecords:2,maxRecordBytes:256,maxBatchBytes:400,now:()=>1792760000010})
  const first=record(),logger=createLogger({sink:processor.sink})
  expect(processor.sink(first)).toBeUndefined();(first.fields as {value:number}).value=99
  for(let i=0;i<4;i++)logger.info('event '+i)
  await vi.waitFor(()=>expect(batches).toHaveLength(1));expect(batches[0]![0]!.record.fields.value).toBe(1)
  expect(processor.stats()).toMatchObject({inFlight:2,queued:3,accepted:5})
  const closing=processor.close();expect(processor.close()).toBe(closing);processor.sink(record('late'));blocked.release();await closing
  expect(batches.map(batch=>batch.length)).toEqual([2,2,1]);expect(close).toHaveBeenCalledTimes(1)
  expect(processor.stats()).toMatchObject({closed:true,queued:0,inFlight:0,bufferedBytes:0,exported:5,dropped:1,closedDrops:1})
})
it('counts active exports against count and byte admission and drops newest work without throwing',async()=>{
  const blocked=gate(),processor=new BufferedLogProcessor({exporter:{export:async()=>blocked.promise,close:async()=>{}},maxBufferedRecords:2,maxBufferedBytes:512,maxRecordBytes:256,maxBatchBytes:256,maxBatchRecords:1})
  processor.sink(record('first'));await vi.waitFor(()=>expect(processor.stats().inFlight).toBe(1));processor.sink(record('second'))
  for(let i=0;i<100;i++)expect(()=>processor.sink(record('excess'))).not.toThrow()
  expect(processor.stats()).toMatchObject({accepted:2,inFlight:1,queued:1,capacityDrops:100});expect(processor.stats().bufferedBytes).toBeLessThanOrEqual(512)
  blocked.release();await processor.close();expect(processor.stats().exported).toBe(2)
  const byteGate=gate(),bytes=new BufferedLogProcessor({exporter:{export:async()=>byteGate.promise,close:async()=>{}},maxBufferedBytes:256,maxRecordBytes:256,maxBatchBytes:256})
  bytes.sink(record('a'.repeat(70)));bytes.sink(record('b'.repeat(70)));expect(bytes.stats()).toMatchObject({accepted:1,capacityDrops:1});byteGate.release();await bytes.close()
})
it('rejects invalid/deep/sparse/cyclic/oversized records without invoking accessors or leaking contents',async()=>{
  let accesses=0;const error=vi.fn(),send=vi.fn(async()=>{}),processor=new BufferedLogProcessor({exporter:{export:send,close:async()=>{}},onError:error,maxRecordBytes:512,maxBatchBytes:512})
  const fields=Object.defineProperty({},'private',{enumerable:true,get:()=>{accesses++;throw new Error('secret')}})
  const cycle:{self?:unknown}={};cycle.self=cycle
  const invalid=[{...record(),fields},{...record(),fields:{nested:cycle}},{...record(),fields:{array:new Array(2)}},{...record(),message:'\ud800'},{...record(),timestamp:'private-not-a-date'},{...record(),message:'x'.repeat(513)}]
  for(const value of invalid)expect(()=>processor.sink(value as LogRecord)).not.toThrow()
  await processor.close();expect(accesses).toBe(0);expect(send).not.toHaveBeenCalled();expect(processor.stats().invalidRecords).toBe(invalid.length)
  expect(JSON.stringify(error.mock.calls)).not.toContain('secret')
})
it('isolates export failure, contains an error observer feeding the same sink and accepts later records',async()=>{
  let unavailable=true;const errors:unknown[]=[]
  const processor=new BufferedLogProcessor({exporter:{export:async()=>{if(unavailable)throw new Error('private endpoint')},close:async()=>{}},onError:error=>{errors.push(error);processor.sink(record('recursive failure'));throw new Error('observer')}})
  processor.sink(record());expect((await processor.flush()).failedBatches).toBe(1)
  expect(processor.stats()).toMatchObject({dropped:2,feedbackDrops:1,exported:0})
  unavailable=false;processor.sink(record('recovered'));await processor.close();expect(processor.stats().exported).toBe(1)
  expect(JSON.stringify(errors)).not.toContain('private')
})
it('sanitizes failed clocks and exporter close while preserving terminal state',async()=>{
  const processor=new BufferedLogProcessor({exporter:{export:async()=>{},close:async()=>{throw new Error('private close')}},now:()=>Number.NaN})
  processor.sink(record());expect(processor.stats().invalidRecords).toBe(1)
  await expect(processor.close()).rejects.toMatchObject({name:'LogProcessorError',operation:'close'});expect(processor.stats().closed).toBe(true)
})
it('splits by encoded entry bytes independently of the record-count batch limit',async()=>{
  const sizes:number[]=[]
  const processor=new BufferedLogProcessor({exporter:{export:async batch=>{sizes.push(batch.length)},close:async()=>{}},maxRecordBytes:256,maxBatchBytes:256,maxBatchRecords:10})
  processor.sink(record('a'.repeat(100)));processor.sink(record('b'.repeat(100)));await processor.close()
  expect(sizes).toEqual([1,1]);expect(processor.stats()).toMatchObject({accepted:2,exported:2,dropped:0})
})
