import { createClient } from '@redis/client'

export type RedisConnectionFailure = 'input' | 'closed' | 'capacity' | 'timeout' | 'connection' | 'command'
export class RedisConnectionError extends Error {
  constructor(readonly code: RedisConnectionFailure) { super('Redis connection failed: ' + code); this.name = 'RedisConnectionError' }
}
export type RedisConnectionOptions = {
  readonly url: string
  readonly allowInsecureLoopback?: boolean
  readonly connectTimeoutMs?: number
  readonly commandTimeoutMs?: number
  readonly closeTimeoutMs?: number
  readonly maxConcurrent?: number
  readonly maxCommandBytes?: number
  /** Explicit CA trust for a private TLS deployment. Certificate verification stays enabled. */
  readonly tlsCa?: string
}
export interface RedisConnection {
  readonly state: 'open' | 'closing' | 'closed'
  execute(command: readonly string[]): Promise<unknown>
  close(): Promise<void>
}
function bounded(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError('Invalid Redis connection limit')
  return value
}
export function redisConnectionUrl(value: string, allowInsecureLoopback = false): string {
  try {
    if (typeof value !== 'string' || value.length > 4096 || !/^rediss?:\/\/[^/?#\s]+(?:\/(?:0|[1-9]\d{0,8})?)?$/i.test(value)) throw new Error()
    const url = new URL(value)
    if (!url.hostname || url.search || url.hash || (url.pathname !== '' && url.pathname !== '/' && !/^\/(0|[1-9]\d{0,8})$/.test(url.pathname)) ||
      (url.protocol !== 'rediss:' && !(allowInsecureLoopback === true && url.protocol === 'redis:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)))) throw new Error()
    decodeURIComponent(url.username); decodeURIComponent(url.password)
    return url.href
  } catch { throw new TypeError('Invalid Redis URL or transport policy') }
}

/** Own one native connection. No reconnect, offline queue, implicit retry or raw credential errors. */
export async function openRedis(options: RedisConnectionOptions): Promise<RedisConnection> {
  const url = redisConnectionUrl(options.url, options.allowInsecureLoopback), connectTimeout = bounded(options.connectTimeoutMs ?? 5000, 60000)
  const commandTimeout = bounded(options.commandTimeoutMs ?? 5000, 60000), closeTimeout = bounded(options.closeTimeoutMs ?? 5000, 60000)
  const maximum = bounded(options.maxConcurrent ?? 16, 1024), maxBytes = bounded(options.maxCommandBytes ?? 2097152, 16777216)
  if (options.tlsCa !== undefined && (typeof options.tlsCa !== 'string' || !options.tlsCa || options.tlsCa.length > 262144 || !url.startsWith('rediss:'))) throw new TypeError('Invalid Redis TLS CA configuration')
  const client = createClient({ url, RESP: 2, socket: { reconnectStrategy: false, connectTimeout, ...(url.startsWith('rediss:') ? { tls: true, rejectUnauthorized: true, ...(options.tlsCa === undefined ? {} : { ca: options.tlsCa }) } : {}) }, commandOptions: { timeout: 0 },
    disableOfflineQueue: true, commandsQueueMaxLength: Math.max(8, maximum), disableClientInfo: true, maintNotifications: 'disabled' })
  let state: 'open' | 'closing' | 'closed' = 'closed', terminal: 'timeout' | 'connection' | undefined, closing: Promise<void> | undefined
  const pending = new Set<Promise<void>>()
  const destroy = (reason: 'timeout' | 'connection') => { terminal ??= reason; state = 'closed'; try { client.destroy() } catch {} }
  client.on('error', () => { terminal ??= 'connection'; if (state === 'open') state = 'closed' })
  const connectionTimer = setTimeout(() => destroy('timeout'), connectTimeout)
  try { await client.connect(); if (terminal) throw new Error(); state = 'open' }
  catch { destroy(terminal ?? 'connection'); throw new RedisConnectionError(terminal ?? 'connection') }
  finally { clearTimeout(connectionTimer) }
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  return Object.freeze({
    get state() { return state },
    execute(command: readonly string[]): Promise<unknown> {
      if (state !== 'open') return Promise.reject(new RedisConnectionError('closed'))
      if (pending.size >= maximum) return Promise.reject(new RedisConnectionError('capacity'))
      if (!Array.isArray(command) || command.length < 1 || command.length > 1024) return Promise.reject(new RedisConnectionError('input'))
      const args = [...command]; let bytes = 0
      for (const value of args) {
        if (typeof value !== 'string' || value.length > maxBytes - bytes) return Promise.reject(new RedisConnectionError('input'))
        const encoded = encoder.encode(value); bytes += encoded.byteLength
        if (bytes > maxBytes || decoder.decode(encoded) !== value) return Promise.reject(new RedisConnectionError('input'))
      }
      let finish!: () => void
      const done = new Promise<void>(resolve => { finish = resolve }); pending.add(done)
      const timer = setTimeout(() => destroy('timeout'), commandTimeout)
      return Promise.resolve().then(() => client.sendCommand(args)).catch(() => { throw new RedisConnectionError(terminal ?? 'command') })
        .finally(() => { clearTimeout(timer); pending.delete(done); finish() })
    },
    close(): Promise<void> {
      return closing ??= (async () => {
        if (state === 'open') state = 'closing'
        while (pending.size) await Promise.all([...pending])
        if (!client.isOpen) { state = 'closed'; return }
        let expired = false
        const timer = setTimeout(() => { expired = true; destroy('timeout') }, closeTimeout)
        try { await client.close(); if (expired) throw new RedisConnectionError('timeout') }
        catch { throw new RedisConnectionError(expired ? 'timeout' : 'connection') }
        finally { clearTimeout(timer); state = 'closed' }
      })()
    },
  })
}
