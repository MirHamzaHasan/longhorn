import { expect, it } from 'vitest'
import { resolveServeOptions } from './index.js'

it('uses consistent listener defaults and keeps explicit ephemeral port zero', () => {
  expect(resolveServeOptions()).toEqual({ hostname: '127.0.0.1', port: 3000 })
  expect(resolveServeOptions({ hostname: ' localhost ', port: 0 })).toEqual({ hostname: 'localhost', port: 0 })
})

it.each([-1, 65536, 1.5, NaN, Infinity])('rejects an invalid listener port: %s', (port) => {
  expect(() => resolveServeOptions({ port })).toThrow(/port/)
})

it.each(['', '   '])('rejects an empty listener hostname: %j', (hostname) => {
  expect(() => resolveServeOptions({ hostname })).toThrow(/hostname/)
})
