import { expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { parse, safeParse, ValidationError } from './index.js'
import type { StandardSchemaV1 } from './index.js'

it('returns transformed output with its inferred type', async () => {
  const schema = z.object({ count: z.string().transform(Number) })
  const result = await parse(schema, { count: '12' })
  expectTypeOf(result).toEqualTypeOf<{ count: number }>()
  expect(result).toEqual({ count: 12 })
})

it('supports asynchronous refinements', async () => {
  const schema = z.string().refine(async (value) => value === 'available', 'Already taken')
  expect(await safeParse(schema, 'available')).toEqual({ success: true, data: 'available' })
  expect(await safeParse(schema, 'taken')).toEqual({
    success: false, issues: [{ path: [], message: 'Already taken' }],
  })
})

it('keeps nested field and array paths in validation failures', async () => {
  const result = await safeParse(z.object({ items: z.array(z.object({ name: z.string() })) }), {
    items: [{ name: 123 }],
  })
  expect(result.success).toBe(false)
  if (!result.success) expect(result.issues[0]?.path).toEqual(['items', 0, 'name'])
})

it('throws a ValidationError with structured issues from parse', async () => {
  const promise = parse(z.string(), 123)
  await expect(promise).rejects.toBeInstanceOf(ValidationError)
  await expect(promise).rejects.toMatchObject({ name: 'ValidationError', message: 'Validation failed' })
})

it('works with a Standard Schema that has no dependency on Zod', async () => {
  const schema: StandardSchemaV1<string, number> = {
    '~standard': {
      version: 1, vendor: 'test',
      validate: (value) => typeof value === 'string'
        ? { value: value.length }
        : { issues: [{ message: 'Expected a string' }] },
    },
  }
  expectTypeOf(await parse(schema, 'LongHorn')).toEqualTypeOf<number>()
  expect(await parse(schema, 'LongHorn')).toBe(8)
})

it('normalizes vendor path segments and removes vendor-specific issue fields', async () => {
  const vendorIssue = {
    message: 'Invalid input',
    path: ['items', { key: 0 }, { key: Symbol.for('field') }],
    input: { password: 'private' },
  }
  const schema: StandardSchemaV1 = {
    '~standard': { version: 1, vendor: 'test', validate: () => ({ issues: [vendorIssue] }) },
  }
  const result = await safeParse(schema, {})
  expect(result).toEqual({
    success: false,
    issues: [{ message: 'Invalid input', path: ['items', 0, 'Symbol(field)'] }],
  })
  expect(JSON.stringify(result)).not.toContain('private')
})

it('does not turn exceptions from schema code into validation failures', async () => {
  const error = new Error('Schema implementation failed')
  const schema: StandardSchemaV1 = {
    '~standard': { version: 1, vendor: 'test', validate: () => { throw error } },
  }
  await expect(safeParse(schema, {})).rejects.toBe(error)
})

it.each([undefined, null, false, 0, ''])('keeps successful falsy output: %s', async (value) => {
  expect(await safeParse(z.unknown(), value)).toEqual({ success: true, data: value })
})
