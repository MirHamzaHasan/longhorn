import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { createServer, connect } from 'node:net'
import { createServer as createTlsServer } from 'node:tls'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { build } from 'tsup'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { Cache, CacheStoreError } from '../packages/cache/dist/index.js'
import { RedisCacheStore } from '../packages/cache/dist/redis.js'
import { jsonCacheCodec } from '../packages/cache/dist/codec.js'
import { openRedis } from '../runtimes/node/dist/redis.js'
import { startRedisSandbox } from './redis-sandbox.mjs'

const root = fileURLToPath(new URL('..', import.meta.url)), temporary = await mkdtemp(join(tmpdir(), 'longhorn-redis-cache-'))
const instances = new Set(), caches = new Set(), connections = new Set(), servers = new Set(), sockets = new Set()
const releases = new Set()
let interrupted = false
let sandbox, admin
const codec = jsonCacheCodec(value => value), key = (namespace, value) => 'longhorn:cache:v1:' + namespace + ':' + Buffer.from(value).toString('base64url')
const checkRunning = () => { if (interrupted) throw new Error('Redis cache verification interrupted') }
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { interrupted = true; for (const release of releases) release(); for (const instance of instances) instance.child.kill('SIGTERM'); for (const socket of sockets) socket.destroy(); void sandbox?.stopServer() })
const waitFor = async action => { const deadline = Date.now() + 10000; while (Date.now() < deadline) { checkRunning(); const value = await action(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 20)) } throw new Error('Redis cache condition timed out') }
async function connection(options) { checkRunning(); const value = await sandbox.open(options); connections.add(value); return value }
async function cache(namespace, options = {}, connectionOptions = {}) {
  const value = new Cache(new RedisCacheStore(await connection(connectionOptions), { namespace, codec, ...options })); caches.add(value); return value
}
function launch(environment) {
  checkRunning()
  const child = spawn(process.execPath, ['examples/basic/dist/redis-index.js'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'info',
    DATABASE_PATH: join(temporary, 'tasks.sqlite'), CACHE_TTL_MS: '60000', REDIS_URL: sandbox.url, REDIS_NAMESPACE: 'http-tasks', REDIS_ALLOW_INSECURE_LOOPBACK: 'true', ...environment }, stdio: ['ignore','pipe','pipe'] })
  let output = ''; const records = []
  for (const stream of [child.stdout,child.stderr]) createInterface({ input: stream }).on('line', line => { output += line + '\n'; try { records.push(JSON.parse(line)) } catch {} })
  child.on('error', error => { output += error.message })
  const instance = { child, records, output: () => output, ended: new Promise(resolve => child.once('close', (code, signal) => { instances.delete(instance); resolve({ code, signal }) })) }
  instances.add(instance); return instance
}
async function stop(instance) {
  if (instance.child.exitCode === null && instance.child.signalCode === null) instance.child.kill('SIGTERM')
  const timer = setTimeout(() => instance.child.kill('SIGKILL'), 5000)
  try { const result = await instance.ended; assert.equal(result.code, 0, instance.output().replaceAll(sandbox.password, '[redacted]')); assert.ok(!instance.output().includes(sandbox.password)); assert.ok(!instance.output().includes('malformed-private-cache-data')) } finally { clearTimeout(timer) }
}
const listening = instance => waitFor(() => { const value = instance.records.find(row => row.message === 'HTTP server listening'); if (value) return value.fields.url; if (instance.child.exitCode !== null) throw new Error(instance.output().replaceAll(sandbox.password, '[redacted]')); return false })
async function server(factory) { checkRunning(); const value = factory(); servers.add(value); await new Promise(resolve => value.listen(0, '127.0.0.1', resolve)); return value }
function ownSocket(socket) { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); return socket }

try {
  const require = createRequire(import.meta.url)
  const bun = join(dirname(require.resolve('bun-runtime/package.json')), 'bin/bun.exe')
  const deno = join(dirname(require.resolve('deno-runtime/package.json')), process.platform === 'win32' ? 'deno.exe' : 'deno')
  for (const [runtime,binary,flags] of [['node',process.execPath,[]],['bun',bun,[]],['deno',deno,['run','--no-prompt','--no-lock','--node-modules-dir=manual']]]) {
    checkRunning()
    const result = await promisify(execFile)(binary,[...flags,join(root,'scripts/fixtures/run-redis-cache.mjs')],{cwd:root,timeout:15000})
    assert.equal(JSON.parse(result.stdout.trim()).runtime,runtime); assert.equal(JSON.parse(result.stdout.trim()).verified,true)
  }
  const bundle = join(temporary,'worker')
  await build({entry:{worker:join(root,'scripts/fixtures/redis-cache-worker.mjs')},outDir:bundle,bundle:true,splitting:false,platform:'browser',target:'es2022',format:['esm'],silent:true})
  const signalListeners = new Map(['SIGINT','SIGTERM'].map(signal => [signal,new Set(process.listeners(signal))]))
  const worker = new Miniflare({modules:true,modulesRoot:bundle,scriptPath:join(bundle,'worker.js'),host:'127.0.0.1',port:0,cf:false,compatibilityDate:'2025-07-18',log:new Log(LogLevel.NONE)})
  for (const [signal,previous] of signalListeners) for (const listener of process.listeners(signal)) if (!previous.has(listener)) process.removeListener(signal,listener)
  try { const response=await worker.dispatchFetch('http://protocol/');assert.equal(response.status,200);assert.equal((await response.json()).verified,true) } finally { await worker.dispose() }
  console.log('Redis shared boundary: built JSON codec and cache command protocol execute on Node, Bun, Deno and real workerd with an explicit fake command client; actual TCP/TLS Redis ownership is verified separately on Node.')
  checkRunning()
  sandbox = await startRedisSandbox(); admin = await connection()
  const version = String(await admin.execute(['INFO','server'])).match(/redis_version:([^\r\n]+)/)?.[1]
  assert.ok(version && Number(version.split('.')[0]) >= 7)
  const stored = await cache('values')
  for (const [name, value] of [['undefined',undefined],['false',false],['null',null],['zero',0],['empty',''],['unicode',{ text: '雪', numbers: [1,2] }]]) {
    await stored.set(name, value, { ttlMs: null }); const result = await stored.get(name); assert.equal(result.hit, true); assert.deepEqual(result.value, value); assert.equal(result.expiresAt, null)
  }
  const clone = await stored.get('unicode'); clone.value.numbers.push(99); assert.deepEqual((await stored.get('unicode')).value.numbers, [1,2])
  await stored.set('ttl', 42, { ttlMs: 300 }); const ttl = await stored.get('ttl'); assert.equal(ttl.hit, true); assert.equal(ttl.expiresAt, await admin.execute(['PEXPIRETIME',key('values','ttl')]))
  await waitFor(async () => !(await stored.get('ttl')).hit)
  await stored.set('zero-ttl', 'old', { ttlMs: null }); await stored.set('zero-ttl', 'new', { ttlMs: 0 }); assert.equal((await stored.get('zero-ttl')).hit, false)
  await stored.set('overflow', 'retained', { ttlMs: null }); await assert.rejects(stored.set('overflow', 'must-not-replace', { ttlMs: Number.MAX_SAFE_INTEGER }), CacheStoreError); assert.equal((await stored.get('overflow')).value, 'retained')
  let loads = 0, releaseLoad; const gate = new Promise(resolve => { releaseLoad = resolve })
  releases.add(releaseLoad)
  const flights = Array.from({ length: 8 }, () => stored.getOrLoad('load', async () => { loads++; await gate; return { count: 1 } }))
  await waitFor(() => loads === 1); releaseLoad(); const loaded = await Promise.all(flights); loaded[0].count = 99; assert.equal(loaded[1].count, 1); assert.equal(loads, 1)
  let releaseStale, entered = false; const stale = stored.getOrLoad('stale', () => { entered = true; return new Promise(resolve => { releaseStale = resolve }) })
  releases.add(() => releaseStale?.())
  await waitFor(() => entered); await stored.delete('stale'); await stored.set('stale', 'newer', { ttlMs: null }); releaseStale('older'); assert.equal(await stale, 'older'); assert.equal((await stored.get('stale')).value, 'newer')
  console.log('Redis ' + version + ': real server TTL/absolute expiry, undefined/falsy JSON, copies, bounded expiry overflow without replacement, shared loads and coordinator invalidation fences verified.')

  const first = await cache('clear', { scanCount: 2 }), neighbor = await cache('clear_other')
  for (let n = 0; n < 45; n++) await first.set('key:' + n + '*', n, { ttlMs: null })
  await neighbor.set('retained', 'other namespace', { ttlMs: null }); await admin.execute(['SET','outside:key','retained'])
  await first.clear(); for (let n = 0; n < 45; n++) assert.equal((await first.get('key:' + n + '*')).hit, false)
  assert.equal((await neighbor.get('retained')).value, 'other namespace'); assert.equal(await admin.execute(['GET','outside:key']), 'retained')
  await admin.execute(['SET',key('values','corrupt'),'malformed-private-cache-data']); await assert.rejects(stored.get('corrupt'), error => error.operation === 'get' && !String(error).includes('private-cache-data'))
  const restrictedPassword = 'c'.repeat(64)
  await admin.execute(['ACL','SETUSER','cache-runtime','on','>' + restrictedPassword,'~longhorn:cache:v1:restricted:*','+auth','+select','+ping','+get','+set','+pexpiretime','+time','+unlink','+scan','+eval'])
  const restrictedUrl = new URL(sandbox.url); restrictedUrl.username = 'cache-runtime'; restrictedUrl.password = restrictedPassword
  const restricted = await openRedis({ url: restrictedUrl.href, allowInsecureLoopback: true }); connections.add(restricted)
  const limited = new Cache(new RedisCacheStore(restricted, { namespace: 'restricted', codec })); caches.add(limited)
  await limited.set('one', 'allowed', { ttlMs: null }); assert.equal((await limited.get('one')).value, 'allowed'); await limited.clear()
  await assert.rejects(restricted.execute(['FLUSHDB']), error => error.code === 'command'); await assert.rejects(restricted.execute(['GET','outside:key']), error => error.code === 'command')
  await assert.rejects(openRedis({ url: sandbox.url.replace(sandbox.password, 'wrong-password'), allowInsecureLoopback: true }), error => error.code === 'connection' && !String(error).includes('wrong-password'))
  await Promise.all([...caches].map(value => value.close())); caches.clear(); await Promise.all([...connections].map(value => value.close())); connections.clear()
  await sandbox.stopServer(); await sandbox.start(); admin = await connection(); const restarted = await cache('values')
  assert.deepEqual((await restarted.get('unicode')).value, { text: '雪', numbers: [1,2] }); assert.equal((await restarted.get('undefined')).hit, true)
  console.log('Redis namespace/restart: SCAN clear keeps neighboring/unrelated keys, restricted ACL works without flush/admin access, malformed values reject, and actual process restart retains typed values through owned AOF storage.')

  // Hold replies after real server commit. Capacity stays owned until timeout tears down TCP;
  // the connection cannot replay a write or reconnect behind the caller's failure.
  let hold = false, peerClosed = false
  const proxy = await server(() => createServer(peer => {
    ownSocket(peer); const upstream = ownSocket(connect({ host: '127.0.0.1', port: sandbox.port }))
    peer.pipe(upstream); upstream.on('data', chunk => { if (!hold) peer.write(chunk) }); upstream.on('end', () => peer.end())
    peer.on('close', () => { peerClosed = true; upstream.destroy() }); upstream.on('error', () => peer.destroy())
  }))
  const proxyUrl = new URL(sandbox.url); proxyUrl.port = String(proxy.address().port)
  const bounded = await openRedis({ url: proxyUrl.href, allowInsecureLoopback: true, maxConcurrent: 1, commandTimeoutMs: 300 }); connections.add(bounded)
  await new Promise(resolve => setTimeout(resolve, 350)); assert.equal(await bounded.execute(['PING']), 'PONG')
  hold = true
  const delayed = bounded.execute(['INCR','transport-counter']).then(value => ({ value }), error => ({ error }))
  await assert.rejects(bounded.execute(['PING']), error => error.code === 'capacity')
  await waitFor(async () => await admin.execute(['GET','transport-counter']) === '1')
  const closing = bounded.close(); assert.equal(bounded.close(), closing); await assert.rejects(bounded.execute(['PING']), error => error.code === 'closed')
  assert.equal((await delayed).error.code, 'timeout'); await closing; await waitFor(() => peerClosed); assert.equal(bounded.state, 'closed'); assert.equal(await admin.execute(['GET','transport-counter']), '1')
  const silent = await server(() => createServer(peer => { ownSocket(peer); peer.resume() }))
  await assert.rejects(openRedis({ url: 'redis://default:private-handshake@127.0.0.1:' + silent.address().port, allowInsecureLoopback: true, connectTimeoutMs: 200 }), error => error.code === 'timeout' && !String(error).includes('private-handshake'))
  console.log('Redis transport: real committed write with withheld reply times out once, rejects excess admission, closes/drains TCP without reconnect/replay, remains usable across idle periods, and bounds stalled authentication.')

  const keyFile = join(temporary,'tls.key'), certFile = join(temporary,'tls.crt')
  await promisify(execFile)('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'])
  const certificate = await readFile(certFile,'utf8')
  const privateKey = await readFile(keyFile)
  const tls = await server(() => { const value = createTlsServer({ key: privateKey, cert: certificate }); value.on('tlsClientError', () => {}); return value })
  tls.on('secureConnection', peer => { ownSocket(peer); const upstream = ownSocket(connect({ host:'127.0.0.1',port:sandbox.port })); peer.pipe(upstream); upstream.pipe(peer); peer.on('close',()=>upstream.destroy()); upstream.on('error',()=>peer.destroy()) })
  const tlsUrl = new URL(sandbox.url); tlsUrl.protocol = 'rediss:'; tlsUrl.port = String(tls.address().port)
  await assert.rejects(openRedis({ url: tlsUrl.href }), error => error.code === 'connection')
  const secure = await openRedis({ url: tlsUrl.href, tlsCa: certificate }); connections.add(secure); assert.equal(await secure.execute(['PING']), 'PONG'); await secure.close()
  console.log('Redis TLS: untrusted native TLS is rejected, an explicitly trusted owned CA succeeds, and credential-bearing failures remain sanitized.')

  let host = launch(), url = await listening(host)
  const summary = async () => { const response = await fetch(url + '/summary'); assert.equal(response.status,200); assert.equal(response.headers.get('Cache-Control'),'no-store'); return (await response.json()).summary }
  const empty = await summary(); assert.equal(empty.total,0); assert.deepEqual(await summary(),empty)
  assert.equal(host.records.filter(row=>row.message==='Task summary computed').length,1)
  const created = await fetch(url + '/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'native Redis task'})}); assert.equal(created.status,201)
  const populated = await summary(); assert.equal(populated.total,1); assert.equal(populated.pending,1)
  await stop(host); host = launch(); url = await listening(host); assert.deepEqual(await summary(),populated); assert.equal(host.records.filter(row=>row.message==='Task summary computed').length,0)
  await sandbox.stopServer()
  assert.equal((await summary()).total,1); await waitFor(() => host.records.some(row=>row.message==='Task summary cache bypassed'))
  const duringOutage = await fetch(url + '/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'committed while Redis unavailable'})}); assert.equal(duringOutage.status,201); assert.equal((await summary()).total,2)
  await sandbox.start(); assert.equal((await summary()).total,2); await stop(host)
  const invalid = launch({ REDIS_URL:'redis://default:invalid-credential@127.0.0.1:' + sandbox.port + '/0' }); assert.equal((await invalid.ended).code,1); assert.ok(!invalid.records.some(row=>row.message==='HTTP server listening')); assert.ok(!invalid.output().includes('invalid-credential'))
  const interruptedHost = launch({ REDIS_URL:'redis://default:private-handshake@127.0.0.1:' + silent.address().port, REDIS_CONNECT_TIMEOUT_MS:'400' })
  await waitFor(() => interruptedHost.records.some(row=>row.message==='Database ready')); await stop(interruptedHost); assert.ok(!interruptedHost.records.some(row=>row.message==='HTTP server listening'))
  admin = await connection(); await admin.execute(['SET',key('http-tasks','summary'),'malformed-private-cache-data'])
  host = launch(); url = await listening(host); assert.equal((await summary()).total,2); assert.equal((await fetch(url + '/tasks')).status,200); await waitFor(() => host.records.some(row=>row.message==='Task summary cache bypassed')); await stop(host)
  console.log('Redis tasks HTTP: real SQLite authority, DI/configuration, cached summary reuse across host restart, committed-write invalidation, outage bypass without failed business writes, sanitized startup rejection and resource cleanup verified.')
} finally {
  for (const release of releases) release()
  for (const instance of instances) { if (instance.child.exitCode === null) instance.child.kill('SIGTERM'); const timer=setTimeout(()=>instance.child.kill('SIGKILL'),5000); try { await instance.ended } finally {clearTimeout(timer)} }
  await Promise.allSettled([...caches].map(value=>value.close())); await Promise.allSettled([...connections].map(value=>value.close()))
  for (const socket of sockets) socket.destroy()
  await Promise.all([...servers].map(value=>new Promise(resolve=>value.close(resolve))))
  await sandbox?.close(); await rm(temporary,{recursive:true,force:true})
}
