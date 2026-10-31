import type { LogRecord,LogSink } from '@longhornjs/logger'
import type { SpanContext } from './tracing.js'
import { snapshotLogEntry } from './log-record.js'
import type { LogEntry } from './log-record.js'
export type { LogEntry } from './log-record.js'
export interface LogExporter { export(entries: readonly LogEntry[]): Promise<void>;close(): Promise<void> }
export class LogProcessorError extends Error {
  constructor(readonly operation:'record'|'export'|'close'){super('Log delivery failed: '+operation);this.name='LogProcessorError'}
}
export type BufferedLogProcessorOptions={
  readonly exporter:LogExporter
  readonly maxBufferedRecords?:number
  readonly maxBufferedBytes?:number
  readonly maxRecordBytes?:number
  readonly maxBatchRecords?:number
  readonly maxBatchBytes?:number
  readonly now?:()=>number
  readonly onError?:(error:LogProcessorError)=>void
}
function limit(value:number,max:number):number{if(!Number.isSafeInteger(value)||value<1||value>max)throw new RangeError('Invalid log buffer limit');return value}
/** A synchronous sink with bounded admission, serial async delivery and an owned final drain. */
export class BufferedLogProcessor {
  private readonly exporter:LogExporter
  private readonly maximum:number
  private readonly byteLimit:number
  private readonly recordBytes:number
  private readonly batchSize:number
  private readonly batchBytes:number
  private readonly now:()=>number
  private readonly onError:BufferedLogProcessorOptions['onError']
  private readonly queue:{entry:LogEntry;bytes:number}[]=[]
  private pumping:Promise<void>|undefined
  private closing:Promise<void>|undefined
  private closed=false
  private reporting=false
  private bufferedBytes=0
  private inFlight=0
  private accepted=0
  private exported=0
  private dropped=0
  private invalidRecords=0
  private capacityDrops=0
  private closedDrops=0
  private feedbackDrops=0
  private failedBatches=0
  constructor(options:BufferedLogProcessorOptions){
    if(typeof options.exporter?.export!=='function'||typeof options.exporter.close!=='function')throw new TypeError('Invalid log exporter')
    this.maximum=limit(options.maxBufferedRecords??1024,100000)
    this.byteLimit=limit(options.maxBufferedBytes??1048576,67108864)
    this.recordBytes=limit(options.maxRecordBytes??16384,1048576)
    this.batchSize=limit(options.maxBatchRecords??64,10000)
    this.batchBytes=limit(options.maxBatchBytes??32768,16777216)
    if(this.recordBytes>this.byteLimit||this.recordBytes>this.batchBytes)throw new RangeError('Log record limit exceeds buffer or batch limit')
    this.exporter=options.exporter;this.now=options.now??Date.now;this.onError=options.onError
  }
  readonly sink:LogSink=record=>this.emit(record)
  emit(record:LogRecord,context?:SpanContext):void{
    if(this.closing||this.closed){this.dropped++;this.closedDrops++;return}
    if(this.reporting){this.dropped++;this.feedbackDrops++;return}
    if(this.queue.length+this.inFlight>=this.maximum){this.dropped++;this.capacityDrops++;return}
    let item:ReturnType<typeof snapshotLogEntry>
    try{item=snapshotLogEntry({record,observedAt:this.now(),...(context===undefined?{}:{context})},this.recordBytes)}
    catch{this.dropped++;this.invalidRecords++;this.report(new LogProcessorError('record'));return}
    if(item.bytes>this.byteLimit-this.bufferedBytes){this.dropped++;this.capacityDrops++;return}
    this.queue.push(item);this.bufferedBytes+=item.bytes;this.accepted++;this.schedule()
  }
  private report(error:LogProcessorError):void{this.reporting=true;try{this.onError?.(error)}catch{}finally{this.reporting=false}}
  private schedule():void{
    if(this.pumping)return
    this.pumping=Promise.resolve().then(async()=>{
      while(this.queue.length){
        let bytes=0,count=0
        while(count<this.queue.length&&count<this.batchSize&&this.queue[count]!.bytes<=this.batchBytes-bytes){bytes+=this.queue[count]!.bytes;count++}
        const batch=this.queue.splice(0,count).map(item=>item.entry)
        this.inFlight=batch.length
        try{await this.exporter.export(batch);this.exported+=batch.length}
        catch{this.failedBatches++;this.dropped+=batch.length;this.report(new LogProcessorError('export'))}
        finally{this.inFlight=0;this.bufferedBytes-=bytes}
      }
    }).finally(()=>{this.pumping=undefined;if(this.queue.length)this.schedule()})
  }
  stats(){return {queued:this.queue.length,inFlight:this.inFlight,bufferedBytes:this.bufferedBytes,accepted:this.accepted,exported:this.exported,dropped:this.dropped,
    invalidRecords:this.invalidRecords,capacityDrops:this.capacityDrops,closedDrops:this.closedDrops,feedbackDrops:this.feedbackDrops,failedBatches:this.failedBatches,closing:this.closing!==undefined,closed:this.closed}}
  async flush(){while(this.pumping)await this.pumping;return this.stats()}
  close():Promise<void>{
    return this.closing??=(async()=>{
      await this.flush()
      try{await this.exporter.close()}catch{const error=new LogProcessorError('close');this.report(error);throw error}finally{this.closed=true}
    })()
  }
}
