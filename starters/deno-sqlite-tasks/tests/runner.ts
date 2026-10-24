import { it as nativeIt } from 'node:test'
import { format } from 'node:util'
export { afterEach } from 'node:test'
export { expect } from 'expect'
export * as vi from 'jest-mock'

/** Expand the shared case tables into real node:test cases in Deno. */
export const it = Object.assign(nativeIt, {
  each<T>(values: readonly T[]) {
    return (name: string, work: (...args: T extends readonly unknown[] ? T : [T]) => unknown) => {
      for (const value of values) {
        const args = (Array.isArray(value) ? value : [value]) as T extends readonly unknown[] ? T : [T]
        nativeIt(format(name, ...args), async () => { await work(...args) })
      }
    }
  },
})
