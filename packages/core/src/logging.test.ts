import { expect, it } from 'vitest'
import { createLogger } from '@longhorn/logger'
import type { LogRecord } from '@longhorn/logger'
import { HTTPException } from '@longhorn/http'
import { Longhorn } from './application.js'

it('correlates application and completion logs with the response request ID', async () => {
  const records: LogRecord[] = []
  const app = new Longhorn({ logger: createLogger({ sink: (record) => records.push(record) }) })
  app.http.get('/hello', (c) => {
    c.get('logger').info('Handled hello')
    return c.json({ id: c.get('requestId') })
  })
  const response = await app.fetch(new Request('http://localhost/hello?token=private'))
  const id = response.headers.get('X-Request-Id')
  expect(id).toMatch(/^[a-f\d-]{36}$/)
  expect(await response.json()).toEqual({ id })
  expect(records).toHaveLength(2)
  expect(records[0]).toMatchObject({ message: 'Handled hello', fields: { requestId: id, method: 'GET', path: '/hello' } })
  expect(records[1]).toMatchObject({ message: 'HTTP request completed', fields: { requestId: id, status: 200 } })
  expect(records[1]?.fields.durationMs).toBeGreaterThanOrEqual(0)
  expect(JSON.stringify(records)).not.toContain('private')
  await app.close()
})

it('generates independent IDs and records client errors without bodies or headers', async () => {
  const records: LogRecord[] = []
  const app = new Longhorn({ logger: createLogger({ sink: (record) => records.push(record) }) })
  app.http.post('/private', () => { throw new HTTPException(400, { message: 'Invalid input' }) })
  const a = await app.fetch(new Request('http://localhost/private', {
    method: 'POST', headers: { Authorization: 'Bearer secret', 'X-Request-Id': 'untrusted' }, body: 'private-body',
  }))
  const b = await app.fetch(new Request('http://localhost/missing'))
  expect(a.headers.get('X-Request-Id')).not.toBe('untrusted')
  expect(a.headers.get('X-Request-Id')).not.toBe(b.headers.get('X-Request-Id'))
  expect(records.map((record) => record.level)).toEqual(['warn', 'warn'])
  expect(records.map((record) => record.fields.status)).toEqual([400, 404])
  expect(JSON.stringify(records)).not.toMatch(/private-body|Bearer secret|untrusted/)
  await app.close()
})

it('logs unexpected errors with request context while keeping the response generic', async () => {
  const records: LogRecord[] = []
  const app = new Longhorn({ logger: createLogger({ sink: (record) => records.push(record) }) })
  app.http.get('/failure', () => { throw new Error('Database unavailable') })
  const response = await app.fetch(new Request('http://localhost/failure'))
  const requestId = response.headers.get('X-Request-Id')
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: 'Internal Server Error' })
  expect(records).toHaveLength(2)
  expect(records[0]).toMatchObject({ level: 'error', message: 'HTTP request failed', fields: {
    requestId, error: { message: 'Database unavailable' },
  } })
  expect(records[1]).toMatchObject({ level: 'error', fields: { requestId, status: 500 } })
  await app.close()
})
