import { MetricRegistry,PeriodicMetricReader } from '../../packages/observability/dist/index.js'
import { OtlpHttpMetricExporter } from '../../packages/observability/dist/otlp-metrics.js'
export async function verifyOtlpMetrics(endpoint,runtime,authorization) {
  let now=1792760000000
  const meter=new MetricRegistry({now:()=>now}),exporter=new OtlpHttpMetricExporter({endpoint,serviceName:'longhorn-metrics-'+runtime,serviceVersion:'1.2.3',
    resourceAttributes:{'runtime.name':runtime,'service.instance.id':runtime+'-native'},headers:{authorization},initialRetryDelayMs:1,maxRetryDelayMs:4,maxDataPointsPerBatch:2})
  const counter=meter.counter({name:'fixture_requests_total',help:'Requests.',labelNames:['route']})
  for(let index=0;index<5;index++)counter.add(index+1,{route:'/template/'+index})
  meter.gauge({name:'fixture_active',help:'Active.',labelNames:['profile']}).set(-0.5,{profile:'雪😀'})
  const histogram=meter.histogram({name:'fixture_latency_seconds',help:'Latency.',buckets:[0,1,2]})
  for(const value of [0,0.5,2,3])histogram.record(value)
  const reader=new PeriodicMetricReader({source:meter,exporter,maxDataPointsPerBatch:2})
  try {
    now++;await reader.flush();counter.add(10,{route:'/template/0'});now++;await reader.close()
    if(exporter.stats().acceptedDataPoints!==14 || reader.stats().batches!==8 || reader.stats().state!=='closed')throw new Error('Metric export did not drain')
    return {verified:true,runtime,exporter:exporter.stats(),reader:reader.stats()}
  } finally {await reader.close();meter.close()}
}
