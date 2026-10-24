import { verifyOtlpLogs } from './otlp-logs-contract.mjs'
export default {async fetch(request){const{endpoint,authorization}=await request.json();try{return Response.json(await verifyOtlpLogs(endpoint,'workers',authorization))}catch{return Response.json({error:'Worker log export failed'},{status:500})}}}
