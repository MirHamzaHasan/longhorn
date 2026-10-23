import { verifyQueue } from './queue-contract.mjs'
const runtime = typeof Bun !== 'undefined' ? 'bun' : typeof Deno !== 'undefined' ? 'deno' : 'node'
console.log(JSON.stringify({ runtime, ...await verifyQueue() }))
