import { verifyObservability } from './observability-contract.mjs'
const runtime = typeof Bun !== 'undefined' ? 'bun' : typeof Deno !== 'undefined' ? 'deno' : 'node'
console.log(JSON.stringify({ runtime, ...await verifyObservability() }))
