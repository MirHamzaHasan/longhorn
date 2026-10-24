import { verifyOtlpLogs } from './otlp-logs-contract.mjs'
const runtime=typeof Bun!=='undefined'?'bun':typeof Deno!=='undefined'?'deno':'node'
const env=typeof Deno!=='undefined'?{endpoint:Deno.env.get('LONGHORN_OTLP_ENDPOINT'),authorization:Deno.env.get('LONGHORN_OTLP_TEST_HEADER')}:{endpoint:process.env.LONGHORN_OTLP_ENDPOINT,authorization:process.env.LONGHORN_OTLP_TEST_HEADER}
console.log(JSON.stringify(await verifyOtlpLogs(env.endpoint,runtime,env.authorization)))
