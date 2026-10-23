import { validateKey, validateTtl } from './types.js'
import type { CacheLookup, CacheStore } from './types.js'
import type { CacheCodec } from './codec.js'
export type { CacheCodec } from './codec.js'

/** Transfer one exclusively owned connection to one store. Commands use RESP arguments. */
export interface RedisCommandClient {
  execute(command: readonly string[]): Promise<unknown>
  close(): Promise<void>
}
export type RedisCacheOptions<T> = {
  readonly namespace: string
  readonly codec: CacheCodec<T>
  readonly maxValueBytes?: number
  readonly maxKeyBytes?: number
  readonly maxConcurrent?: number
  readonly scanCount?: number
  readonly maxScanPages?: number
}
export class RedisCacheError extends Error {
  constructor(readonly code: 'closed' | 'capacity' | 'key' | 'value' | 'protocol' | 'scan-limit') {
    super('Redis cache operation failed: ' + code); this.name = 'RedisCacheError'
  }
}
const readScript = `local value=redis.call('GET',KEYS[1])
if not value then return {} end
local expiry=redis.call('PEXPIRETIME',KEYS[1])
if expiry == -2 then return {} end
return {value,expiry}`
const writeScript = `local ttl=tonumber(ARGV[2])
if ttl == -1 then return redis.call('SET',KEYS[1],ARGV[1]) end
local time=redis.call('TIME')
local now=tonumber(time[1])*1000+math.floor(tonumber(time[2])/1000)
if now < 0 or ttl > 9007199254740991-now then return redis.error_reply('CACHE_EXPIRY_RANGE') end
return redis.call('SET',KEYS[1],ARGV[1],'PX',ARGV[2])`
function limit(value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new RangeError('Invalid Redis cache limit')
  return value
}

/** Redis 7+ standalone storage. Flight/version fences stay owned by the Cache coordinator. */
export class RedisCacheStore<T> implements CacheStore<T> {
  private readonly prefix: string
  private readonly maxValue: number
  private readonly maxKey: number
  private readonly maximum: number
  private readonly count: number
  private readonly pages: number
  private readonly encode: CacheCodec<T>['encode']
  private readonly decode: CacheCodec<T>['decode']
  private readonly pending = new Set<Promise<void>>()
  private state: 'open' | 'closing' | 'closed' = 'open'
  private closing: Promise<void> | undefined
  constructor(private readonly client: RedisCommandClient, options: RedisCacheOptions<T>) {
    if (!options || typeof options.namespace !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(options.namespace)) throw new TypeError('Invalid Redis cache namespace')
    if (typeof options.codec?.encode !== 'function' || typeof options.codec.decode !== 'function' || typeof client?.execute !== 'function' || typeof client.close !== 'function') throw new TypeError('Invalid Redis cache resources')
    this.prefix = 'longhorn:cache:v1:' + options.namespace + ':'
    this.maxValue = limit(options.maxValueBytes ?? 65536, 1048576)
    this.maxKey = limit(options.maxKeyBytes ?? 1024, 65536)
    this.maximum = limit(options.maxConcurrent ?? 16, 1024)
    this.count = limit(options.scanCount ?? 100, 1000)
    this.pages = limit(options.maxScanPages ?? 10000, 1000000)
    this.encode = options.codec.encode.bind(options.codec); this.decode = options.codec.decode.bind(options.codec)
  }
  private text(value: string, maximum: number, code: 'key' | 'value'): Uint8Array {
    if (typeof value !== 'string' || value.length > maximum) throw new RedisCacheError(code)
    const bytes = new TextEncoder().encode(value)
    if (bytes.byteLength > maximum || new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== value) throw new RedisCacheError(code)
    return bytes
  }
  private key(value: string): string {
    validateKey(value)
    const bytes = this.text(value, this.maxKey, 'key')
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
    return this.prefix + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  get(key: string): Promise<CacheLookup<T>> {
    return this.run(async () => {
      const result = await this.client.execute(['EVAL', readScript, '1', this.key(key)])
      if (!Array.isArray(result)) throw new RedisCacheError('protocol')
      if (result.length === 0) return { hit: false }
      if (result.length !== 2 || typeof result[0] !== 'string' || typeof result[1] !== 'number' || (result[1] !== -1 && (!Number.isSafeInteger(result[1]) || result[1] < 0))) throw new RedisCacheError('protocol')
      this.text(result[0], this.maxValue, 'value')
      return { hit: true, value: await this.decode(result[0]), expiresAt: result[1] === -1 ? null : result[1] }
    })
  }
  set(key: string, value: T, ttlMs: number | null): Promise<void> {
    return this.run(async () => {
      const name = this.key(key); validateTtl(ttlMs)
      if (ttlMs === 0) { await this.remove([name]); return }
      const encoded = await this.encode(value)
      this.text(encoded, this.maxValue, 'value')
      if (await this.client.execute(['EVAL', writeScript, '1', name, encoded, ttlMs === null ? '-1' : String(ttlMs)]) !== 'OK') throw new RedisCacheError('protocol')
    })
  }
  delete(key: string): Promise<void> { return this.run(() => this.remove([this.key(key)])) }
  clear(): Promise<void> {
    return this.run(async () => {
      let cursor = '0'
      for (let page = 0; page < this.pages; page++) {
        const result = await this.client.execute(['SCAN', cursor, 'MATCH', this.prefix + '*', 'COUNT', String(this.count)])
        if (!Array.isArray(result) || result.length !== 2 || typeof result[0] !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(result[0]) || !Array.isArray(result[1])) throw new RedisCacheError('protocol')
        const keys: unknown[] = result[1]
        if (keys.some(key => typeof key !== 'string' || !key.startsWith(this.prefix))) throw new RedisCacheError('protocol')
        for (let offset = 0; offset < keys.length; offset += this.count) await this.remove(keys.slice(offset, offset + this.count) as string[])
        cursor = result[0]; if (cursor === '0') return
      }
      throw new RedisCacheError('scan-limit')
    })
  }
  private async remove(keys: readonly string[]): Promise<void> {
    const result = await this.client.execute(['UNLINK', ...keys])
    if (typeof result !== 'number' || !Number.isInteger(result) || result < 0 || result > keys.length) throw new RedisCacheError('protocol')
  }
  private run<R>(work: () => Promise<R>): Promise<R> {
    if (this.state !== 'open') return Promise.reject(new RedisCacheError('closed'))
    if (this.pending.size >= this.maximum) return Promise.reject(new RedisCacheError('capacity'))
    let finish!: () => void
    const done = new Promise<void>(resolve => { finish = resolve }); this.pending.add(done)
    return Promise.resolve().then(work).finally(() => { this.pending.delete(done); finish() })
  }
  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.state = 'closing'
      try { while (this.pending.size) await Promise.all([...this.pending]); await this.client.close() }
      finally { this.state = 'closed' }
    })()
  }
}
