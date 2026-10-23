import { verifyOtlp } from './otlp-contract.mjs'
const runtime=typeof Bun!=='undefined' ? 'bun' : typeof Deno!=='undefined' ? 'deno' : 'node'
const environment=typeof Deno!=='undefined' ? { LONGHORN_OTLP_ENDPOINT: Deno.env.get('LONGHORN_OTLP_ENDPOINT'),LONGHORN_OTLP_TEST_HEADER: Deno.env.get('LONGHORN_OTLP_TEST_HEADER') } : process.env
console.log(JSON.stringify(await verifyOtlp(environment.LONGHORN_OTLP_ENDPOINT,runtime,environment.LONGHORN_OTLP_TEST_HEADER)))
