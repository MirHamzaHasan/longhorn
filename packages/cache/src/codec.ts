/** Persistence codecs own their schema; they must preserve the cache's declared T. */
export interface CacheCodec<T> {
  encode(value: T): string | Promise<string>
  decode(value: string): T | Promise<T>
}
export class CacheCodecError extends Error {
  constructor() { super('Invalid cache value or encoded data'); this.name = 'CacheCodecError' }
}

/** Versioned, bounded JSON with explicit top-level undefined; parser errors stay private. */
export function jsonCacheCodec<T>(parse: (input: unknown) => T | Promise<T>, options: { readonly maxBytes?: number } = {}): CacheCodec<T> {
  if (typeof parse !== 'function') throw new TypeError('Cache codec requires a parser')
  const maximum = options.maxBytes ?? 65536, encoder = new TextEncoder()
  if (!Number.isSafeInteger(maximum) || maximum < 16 || maximum > 1048576) throw new RangeError('Invalid cache codec byte limit')
  function snapshot(value: unknown): string {
    let bytes = 0
    const ancestors = new Set<object>()
    const append = (text: string) => { bytes += encoder.encode(text).byteLength; if (bytes > maximum) throw new CacheCodecError(); return text }
    const quoted = (value: string) => { if (value.length > maximum) throw new CacheCodecError(); return append(JSON.stringify(value)) }
    function visit(value: unknown, depth: number): string {
      if (depth > 32) throw new CacheCodecError()
      if (typeof value === 'string') return quoted(value)
      if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return append(JSON.stringify(value))
      if (typeof value !== 'object' || value === null || ancestors.has(value)) throw new CacheCodecError()
      const array = Array.isArray(value), prototype = Object.getPrototypeOf(value)
      if ((!array && prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length) throw new CacheCodecError()
      const keys = Object.getOwnPropertyNames(value).filter(name => !(array && name === 'length'))
      if (keys.length > maximum || (array && (keys.length !== value.length || keys.some((key, index) => key !== String(index))))) throw new CacheCodecError()
      ancestors.add(value)
      try {
        const parts = [append(array ? '[' : '{')]
        for (const [index, key] of (array ? keys : keys.sort()).entries()) {
          const descriptor = Object.getOwnPropertyDescriptor(value, key)!
          if (!descriptor.enumerable || !('value' in descriptor)) throw new CacheCodecError()
          if (index) parts.push(append(','))
          if (!array) parts.push(quoted(key), append(':'))
          parts.push(visit(descriptor.value, depth + 1))
        }
        parts.push(append(array ? ']' : '}')); return parts.join('')
      } finally { ancestors.delete(value) }
    }
    if (value === undefined) return append('[1,"undefined"]')
    return append('[1,"value",') + visit(value, 0) + append(']')
  }
  function unwrap(encoded: string): unknown {
    if (typeof encoded !== 'string' || encoded.length > maximum || encoder.encode(encoded).byteLength > maximum) throw new CacheCodecError()
    const value: unknown = JSON.parse(encoded)
    if (!Array.isArray(value) || value[0] !== 1) throw new CacheCodecError()
    if (value.length === 2 && value[1] === 'undefined') return undefined
    if (value.length === 3 && value[1] === 'value') return value[2]
    throw new CacheCodecError()
  }
  return Object.freeze({
    async encode(value: T): Promise<string> {
      try { return snapshot(await parse(unwrap(snapshot(value)))) } catch { throw new CacheCodecError() }
    },
    async decode(encoded: string): Promise<T> {
      try {
        const value = unwrap(encoded)
        snapshot(value)
        const result = await parse(value); snapshot(result); return result
      } catch { throw new CacheCodecError() }
    },
  })
}
