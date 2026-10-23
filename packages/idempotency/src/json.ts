import { IdempotencyInputError } from './index.js'

/** Strict JSON only: no getters, coercions, toJSON, sparse arrays or silent lossy values. */
export function jsonSnapshot(value: unknown, maxBytes: number): string {
  const ancestors = new Set<object>(), encoder = new TextEncoder()
  let bytes = 0
  const append = (value: string) => {
    bytes += encoder.encode(value).byteLength
    if (bytes > maxBytes) throw new IdempotencyInputError('Idempotency JSON exceeds byte limit')
    return value
  }
  function visit(value: unknown, depth: number): string {
    if (depth > 32) throw new IdempotencyInputError('Idempotency JSON exceeds depth limit')
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return append(JSON.stringify(value))
    if (typeof value === 'number' && Number.isFinite(value)) return append(JSON.stringify(value))
    if (typeof value !== 'object' || value === null || ancestors.has(value)) throw new IdempotencyInputError('Idempotency values must be finite, acyclic JSON')
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value)
    if ((!array && prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length) throw new IdempotencyInputError('Idempotency values must be plain JSON')
    ancestors.add(value)
    try {
      const keys = Object.keys(value)
      if (array && (keys.length !== value.length || keys.some((key, index) => key !== String(index)))) throw new IdempotencyInputError('Idempotency arrays must be dense JSON')
      const parts: string[] = [append(array ? '[' : '{')]
      for (const [index, key] of (array ? keys : keys.sort()).entries()) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!
        if (!('value' in descriptor)) throw new IdempotencyInputError('Idempotency JSON cannot contain getters')
        if (index) parts.push(append(','))
        if (!array) parts.push(append(JSON.stringify(key)), append(':'))
        parts.push(visit(descriptor.value, depth + 1))
      }
      parts.push(append(array ? ']' : '}'))
      return parts.join('')
    } finally { ancestors.delete(value) }
  }
  return visit(value, 0)
}
