import { Cache } from '../../packages/cache/dist/index.js'
import { RedisCacheStore } from '../../packages/cache/dist/redis.js'
import { jsonCacheCodec } from '../../packages/cache/dist/codec.js'
const check = (value, message) => { if (!value) throw new Error(message) }
/** Portable JSON/protocol boundary, with an explicit fake command client; actual TCP Redis is separately verified on Node. */
export async function verifyRedisCacheProtocol() {
  const codec = jsonCacheCodec(value => value)
  for (const value of [undefined, null, false, 0, '', { text:'雪',values:[1,2] }]) check(JSON.stringify(await codec.decode(await codec.encode(value))) === JSON.stringify(value), 'JSON value changed')
  let executed = false
  try { await codec.encode({ get value() { executed = true; return 1 } }); throw new Error('Getter accepted') } catch (error) { check(error.name === 'CacheCodecError', 'Wrong codec error') }
  check(!executed, 'Codec invoked a getter')
  let raw, closed = false; const commands = []
  const client = { async execute(command) {
    commands.push([...command])
    if (command[0] === 'EVAL' && command.length === 6) { raw = command[4]; return 'OK' }
    if (command[0] === 'EVAL') return raw === undefined ? [] : [raw,-1]
    if (command[0] === 'UNLINK') { raw = undefined; return 1 }
    if (command[0] === 'SCAN') return ['0',[]]
    throw new Error('Unexpected protocol command')
  }, async close() { closed = true } }
  const cache = new Cache(new RedisCacheStore(client,{namespace:'portable',codec}))
  await cache.set('\uFEFF雪:*', { count:1 },{ttlMs:null})
  const one = await cache.get('\uFEFF雪:*'); one.value.count = 5
  check((await cache.get('\uFEFF雪:*')).value.count === 1,'Cache copy isolation failed')
  const expected = commands[0][3]; check(/^longhorn:cache:v1:portable:[A-Za-z0-9_-]+$/.test(expected),'Key escaped its namespace')
  await cache.delete('\uFEFF雪:*'); check(!(await cache.get('\uFEFF雪:*')).hit,'Delete became a hit')
  await cache.close(); check(closed,'Store did not release its client')
  return { verified:true }
}
