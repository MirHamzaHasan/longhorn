import { verifyOtlpMetrics } from './otlp-metrics-contract.mjs'
export default {async fetch(request){const{endpoint,authorization}=await request.json();try{return Response.json(await verifyOtlpMetrics(endpoint,'workers',authorization))}catch{return Response.json({error:'Worker metric export failed'},{status:500})}}}
