import { afterEach, expect, it, vi } from 'vitest'
import { createLogger } from './index.js'
import type { LogRecord } from './index.js'

afterEach(() => vi.restoreAllMocks())

it('filters levels and emits a stable structured record', () => {
  const records: LogRecord[] = []
  const logger = createLogger({ level: 'warn', sink: (record) => records.push(record), clock: () => new Date(0) })
  logger.debug('debug')
  logger.info('info')
  logger.warn('Retrying', { attempts: 2 })
  logger.error('Failed')
  expect(records).toEqual([
    { timestamp: '1970-01-01T00:00:00.000Z', level: 'warn', message: 'Retrying', fields: { attempts: 2 } },
    { timestamp: '1970-01-01T00:00:00.000Z', level: 'error', message: 'Failed', fields: {} },
  ])
})

it('merges child bindings without modifying parent context or reserved fields', () => {
  const records: LogRecord[] = []
  const logger = createLogger({ bindings: { app: 'LongHorn' }, sink: (record) => records.push(record) })
  const child = logger.child({ requestId: 'one' })
  child.info('Child', { requestId: 'two', level: 'spoofed' })
  logger.info('Parent')
  expect(records[0]).toMatchObject({ level: 'info', fields: { app: 'LongHorn', requestId: 'two', level: 'spoofed' } })
  expect(records[1]?.fields).toEqual({ app: 'LongHorn' })
})

it('redacts matching keys recursively without changing application data', () => {
  const sink = vi.fn()
  const fields = { user: { password: 'private' }, Authorization: 'Bearer private', apiKey: 'private' }
  createLogger({ sink }).info('Login', fields)
  expect(sink).toHaveBeenCalledWith(expect.objectContaining({
    fields: { user: { password: '[Redacted]' }, Authorization: '[Redacted]', apiKey: '[Redacted]' },
  }))
  expect(fields.user.password).toBe('private')
})

it('allows custom redaction keys', () => {
  const sink = vi.fn()
  createLogger({ sink, redact: ['privateValue'] }).info('Custom', { privateValue: 'hidden', publicValue: 'visible' })
  expect(sink).toHaveBeenCalledWith(expect.objectContaining({ fields: {
    privateValue: '[Redacted]', publicValue: 'visible',
  } }))
})

it('serializes errors, bigint, and circular data into JSON-safe values', () => {
  const records: LogRecord[] = []
  const cycle: Record<string, unknown> = { count: 12n }
  cycle.self = cycle
  const error = new Error('Service failed', { cause: new Error('Offline') })
  createLogger({ sink: (record) => records.push(record) }).error('Failed', { error, cycle })
  expect(records[0]?.fields).toMatchObject({
    error: { name: 'Error', message: 'Service failed', cause: { message: 'Offline' } },
    cycle: { count: '12', self: '[Circular]' },
  })
  expect(() => JSON.stringify(records)).not.toThrow()
})

it('does not mistake shared references for cycles', () => {
  const sink = vi.fn()
  const shared = { value: 1 }
  createLogger({ sink }).info('Shared', { a: shared, b: shared })
  expect(sink).toHaveBeenCalledWith(expect.objectContaining({ fields: { a: shared, b: shared } }))
})

it('does not let a failing sink or unsafe input break application work', () => {
  const logger = createLogger({ sink: () => { throw new Error('Sink offline') } })
  expect(() => logger.error('Still running', { count: 1n })).not.toThrow()
  const unsafe = Object.defineProperty({}, 'value', { enumerable: true, get: () => { throw new Error('getter') } })
  expect(() => logger.info('Unsafe', unsafe)).not.toThrow()
})

it('keeps a silent logger silent', () => {
  const sink = vi.fn()
  const logger = createLogger({ level: 'silent', sink })
  logger.error('Hidden')
  logger.child({ app: 'test' }).info('Hidden too')
  expect(sink).not.toHaveBeenCalled()
})

it('writes JSON to the appropriate console methods by default', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const logger = createLogger()
  logger.info('Ready')
  logger.warn('Retry')
  logger.error('Failed')
  expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toMatchObject({ level: 'info', message: 'Ready' })
  expect(warn).toHaveBeenCalledTimes(1)
  expect(error).toHaveBeenCalledTimes(1)
})
