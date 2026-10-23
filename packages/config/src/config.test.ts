import { expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { ValidationError } from '@longhorn/validation'
import type { StandardSchemaV1 } from '@longhorn/validation'
import { ConfigError, loadConfig } from './index.js'

it('infers transformed settings and applies schema defaults', async () => {
  const schema = z.object({ PORT: z.coerce.number().default(3000), NAME: z.string() })
    .transform(({ PORT, NAME }) => ({ port: PORT, name: NAME }))
  const config = await loadConfig(schema, { NAME: 'LongHorn' })
  expectTypeOf(config).toEqualTypeOf<Readonly<{ port: number; name: string }>>()
  expect(config).toEqual({ port: 3000, name: 'LongHorn' })
})

it('uses later defined source values while preserving empty strings, false, and zero', async () => {
  const schema = z.object({ name: z.string(), enabled: z.boolean(), count: z.number(), region: z.string() })
  const config = await loadConfig(schema,
    { name: 'default', enabled: true, count: 9, region: 'local' },
    { name: '', enabled: false, count: 0, region: undefined },
  )
  expect(config).toEqual({ name: '', enabled: false, count: 0, region: 'local' })
})

it('supports loading schema defaults without a source', async () => {
  expect(await loadConfig(z.object({ port: z.number().default(3000) }))).toEqual({ port: 3000 })
})

it('does not mutate sources and freezes the validated top-level snapshot', async () => {
  const source = { PORT: '3000' }
  const config = await loadConfig(z.object({ PORT: z.coerce.number() }), source)
  expect(source).toEqual({ PORT: '3000' })
  source.PORT = '4000'
  expect(config.PORT).toBe(3000)
  expect(Object.isFrozen(config)).toBe(true)
  expect(Reflect.set(config, 'PORT', 5000)).toBe(false)
})

it('reports configuration fields without including submitted values in the summary', async () => {
  const promise = loadConfig(z.object({ TOKEN: z.string().refine(() => false, 'Rejected secret-value') }), {
    TOKEN: 'secret-value',
  })
  await expect(promise).rejects.toBeInstanceOf(ConfigError)
  await expect(promise).rejects.toBeInstanceOf(ValidationError)
  await expect(promise).rejects.toMatchObject({
    name: 'ConfigError', message: 'Invalid configuration: TOKEN',
    issues: [{ path: ['TOKEN'], message: 'Rejected secret-value' }],
  })
})

it('includes all failed field paths in a startup error', async () => {
  await expect(loadConfig(z.object({ HOST: z.string(), PORT: z.number() }), {}))
    .rejects.toMatchObject({ message: 'Invalid configuration: HOST, PORT' })
})

it('supports async schemas and schema-independent configuration', async () => {
  const schema: StandardSchemaV1<unknown, { port: number }> = {
    '~standard': { version: 1, vendor: 'test', validate: async () => ({ value: { port: 1234 } }) },
  }
  expect(await loadConfig(schema)).toEqual({ port: 1234 })
})

it('keeps schema implementation failures distinct from invalid settings', async () => {
  const error = new Error('Settings backend failed')
  const schema: StandardSchemaV1<unknown, object> = {
    '~standard': { version: 1, vendor: 'test', validate: () => { throw error } },
  }
  await expect(loadConfig(schema)).rejects.toBe(error)
})

it('does not treat inherited source properties as configuration', async () => {
  const source = Object.create({ TOKEN: 'inherited' }) as Record<string, unknown>
  source.PORT = '3000'
  const schema = z.object({ PORT: z.string(), TOKEN: z.string().optional() })
  expect(await loadConfig(schema, source)).toEqual({ PORT: '3000' })
})

it('keeps a __proto__ key as data rather than changing the merged object prototype', async () => {
  const schema: StandardSchemaV1<unknown, Record<string, unknown>> = {
    '~standard': {
      version: 1, vendor: 'test',
      validate: (value) => ({ value: value as Record<string, unknown> }),
    },
  }
  const config = await loadConfig(schema, JSON.parse('{"__proto__":{"polluted":true}}'))
  expect(Object.getPrototypeOf(config)).toBeNull()
  expect(Object.hasOwn(config, '__proto__')).toBe(true)
  expect(config.polluted).toBeUndefined()
})
