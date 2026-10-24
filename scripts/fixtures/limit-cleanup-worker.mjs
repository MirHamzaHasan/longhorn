import { RateLimitCleanup } from '../../packages/ratelimit/dist/cleanup.js'
import { RateLimiter } from '../../packages/ratelimit/dist/index.js'
import { MemoryRateLimitStore } from '../../packages/ratelimit/dist/memory.js'
import { cleanupContract } from './cleanup-contract.mjs'
export default { async fetch() {
  let time = 100
  const store = new MemoryRateLimitStore({ maxEntries: 4 }), limiter = new RateLimiter({ scope: 'finite', limit: 1, windowMs: 1000, store, now: () => time })
  let cleanup
  try {
    await limiter.consume('expired'); time = 1100; cleanup = new RateLimitCleanup(limiter, { intervalMs: 5 }); cleanup.start()
    const deadline = Date.now() + 5000
    while (cleanup.snapshot().removed !== 1) { if (Date.now() >= deadline) throw new Error('Finite cleanup timed out'); await new Promise(done => setTimeout(done, 1)) }
    await cleanup.close()
    if (!(await limiter.consume('expired')).allowed) throw new Error('Expired budget not replenished')
    return Response.json({ runtime: 'workerd', memory: true, ...await cleanupContract(RateLimitCleanup) })
  } finally { await cleanup?.close(); await limiter.close() }
} }
