import { createLogger,fanoutLogSinks } from '../../packages/logger/dist/index.js'
import { BufferedLogProcessor } from '../../packages/observability/dist/index.js'
import { OtlpHttpLogExporter } from '../../packages/observability/dist/otlp-logs.js'
export async function verifyOtlpLogs(endpoint,runtime,authorization){
  const local=[],context={traceId:'1'.repeat(32),spanId:'2'.repeat(16),sampled:true}
  const exporter=new OtlpHttpLogExporter({endpoint,serviceName:'longhorn-logs-'+runtime,resourceAttributes:{'runtime.name':runtime},headers:{authorization},initialRetryDelayMs:1,maxRetryDelayMs:4})
  const processor=new BufferedLogProcessor({exporter,maxBatchRecords:2,now:()=>1792760000010.25})
  const logger=createLogger({level:'debug',bindings:{app:'fixture'},clock:()=>new Date(1792760000000),sink:fanoutLogSinks([record=>local.push(record),record=>processor.emit(record,record.level==='warn'?undefined:context)])})
  try{
    const fields={integer:42,fraction:1.5,yes:true,nothing:null,array:[1,'雪😀',null],object:{status:'ok'},password:'private-log-sentinel'}
    logger.debug('fixture.debug',fields);fields.object.status='mutated';logger.info('fixture.info');logger.warn('fixture.warn');logger.error('fixture.error')
    if(local.length!==4||processor.stats().exported!==0)throw new Error('Logging lost its synchronous boundary')
    await processor.close()
    if(processor.stats().exported!==4||processor.stats().dropped||!processor.stats().closed)throw new Error('Log processor did not drain')
    return {runtime,verified:true,processor:processor.stats(),exporter:exporter.stats()}
  }finally{await processor.close()}
}
