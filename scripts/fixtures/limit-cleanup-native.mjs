import assert from 'node:assert/strict'
import { RateLimiter } from '../../packages/ratelimit/dist/index.js'
import { RateLimitCleanup } from '../../packages/ratelimit/dist/cleanup.js'
import { SqliteRateLimitStore, rateLimitMigrations } from '../../packages/ratelimit/dist/sqlite.js'
import { migrate } from '../../packages/database/dist/index.js'
import { cleanupContract } from './cleanup-contract.mjs'
const runtime = globalThis.Deno ? 'deno' : globalThis.Bun ? 'bun' : 'node', filename = globalThis.Deno ? Deno.args[0] : process.argv[2]
const { openSqlite } = await import('../../runtimes/' + runtime + '/dist/sqlite.js')
const database = await openSqlite({ filename }), peer = await openSqlite({ filename }), limiters = []
const sleep = ms => new Promise(done => setTimeout(done, ms))
const waitFor = async test => { const end = Date.now() + 5000; while (Date.now() < end) { if (await test()) return; await sleep(2) }; throw new Error('Native limit cleanup condition timed out') }
let cleanup, writing, release
try {
  await migrate(database, rateLimitMigrations)
  let clock = 100, nativeEntered = false
  const batches = [], observed = { dialect: peer.dialect, transaction: peer.transaction.bind(peer), close: peer.close.bind(peer), execute: async statement => {
    nativeEntered = true; const result = await peer.execute(statement); batches.push(result.rowsAffected); return result
  } }
  const make = (scope, windowMs, db = database) => { const limiter = new RateLimiter({ scope, limit: 1, windowMs, now: () => clock, store: new SqliteRateLimitStore(db) }); limiters.push(limiter); return limiter }
  const short = make('short', 1000), other = make('other', 1000), live = make('live', 10000), maintenance = make('maintenance', 1000, observed)
  for (const subject of ['a', 'b']) await short.consume(subject); await other.consume('c'); await live.consume('retained'); clock = 1100
  let locked = false
  const gate = new Promise(done => { release = done })
  writing = database.transaction(async tx => { await tx.execute('UPDATE longhorn_rate_limit_buckets SET attempts=attempts'); locked = true; await gate }); await waitFor(() => locked)
  cleanup = new RateLimitCleanup(maintenance, { limit: 2, intervalMs: 10 }); cleanup.start(); await waitFor(() => nativeEntered)
  let closed = false; const closing = cleanup.close().then(() => { closed = true }); await sleep(20); assert.equal(closed, false); assert.equal(cleanup.snapshot().active, true)
  release(); await writing; writing = undefined; await closing; assert.equal(cleanup.snapshot().removed, 2); assert.deepEqual(batches, [2])
  cleanup = new RateLimitCleanup(maintenance, { limit: 1, intervalMs: 5 }); cleanup.start(); await waitFor(() => cleanup.snapshot().removed === 1); await cleanup.close()
  assert.ok(batches.every(n => n >= 0 && n <= 2)); assert.equal(Number((await database.execute('SELECT count(*) AS total FROM longhorn_rate_limit_buckets')).rows[0].total), 1)
  assert.equal((await live.consume('retained')).allowed, false); assert.equal((await short.consume('a')).allowed, true); assert.equal(await maintenance.prune(1), 0)
  console.log(JSON.stringify({ runtime, sqlite: true, expiredAcrossScopes: 3, boundedBatches: true, livePolicyPreserved: true, exhaustedThenReplenished: true, heldNativeDrain: true, borrowedLimiterOpen: true, ...await cleanupContract(RateLimitCleanup) }))
} finally { release?.(); await writing?.catch(() => {}); await cleanup?.close(); await Promise.all(limiters.map(limiter => limiter.close())); await peer.close(); await database.close() }
