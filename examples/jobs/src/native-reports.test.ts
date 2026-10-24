import { expect, it } from 'vitest'
import { createNativeReportComputer, nativeReportProtocol } from './native-reports.js'
import { configSchema } from './config.js'
import { reportHandler } from './reports.js'
import { openSqlite } from '@longhorn/node/sqlite'
import { migrate } from '@longhorn/database'
import { reportMigrations } from './reports.js'

const token = 'test_native_reports_credential_1234567890'
const wire = (report = { count: 2, sum: 6, min: 2, max: 4 }) => ({ protocol: nativeReportProtocol, report })
const options = { baseUrl: 'http://127.0.0.1:3020/', token, allowInsecureLoopback: true }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }

it('snapshots the request and verifies protocol, count and result shape', async () => {
  const bodies: string[] = []
  const client = createNativeReportComputer({ ...options, fetch: async (_url, init) => { bodies.push(String(init?.body)); return Response.json(wire()) } })
  const input = { numbers: [2, 4] }, result = client.compute(input)
  input.numbers[0] = 99
  expect(await result).toEqual({ count: 2, sum: 6, min: 2, max: 4 }); expect(bodies).toEqual(['{"numbers":[2,4]}'])
  for (const input of [{ numbers: [] }, { numbers: [NaN] }, { numbers: [1e13] }, { numbers: Array(1001).fill(1) }]) await expect(client.compute(input)).rejects.toMatchObject({ code: 'input' })
  await client.close()
})

it('rejects remote diagnostics, incompatible schemas and mismatched results without copying remote data', async () => {
  for (const value of [wire({ count: 1, sum: 6, min: 2, max: 4 }), { ...wire(), protocol: 'wrong' }, { ...wire(), private: 'secret' }, wire({ count: 2, sum: 6, min: 4, max: 2 })]) {
    const client = createNativeReportComputer({ ...options, fetch: async () => Response.json(value) })
    await expect(client.compute({ numbers: [2, 4] })).rejects.toMatchObject({ code: 'protocol' }); await client.close()
  }
  const client = createNativeReportComputer({ ...options, fetch: async () => Response.json({ secret: token }, { status: 503 }) })
  await expect(client.compute({ numbers: [2, 4] })).rejects.toThrow(/^Native report operation failed: unavailable$/)
  expect(await client.healthy()).toBe(false); await client.close()
})

it('bounds admission and drains an actual transport that ignores abort before closing', async () => {
  const entered = deferred(), release = deferred()
  const client = createNativeReportComputer({ ...options, maxConcurrent: 1, timeoutMs: 5, fetch: async () => { entered.resolve(); await release.promise; return Response.json(wire()) } })
  const operation = client.compute({ numbers: [2, 4] }).catch(error => error)
  await entered.promise
  await expect(client.compute({ numbers: [2, 4] })).rejects.toMatchObject({ code: 'capacity' })
  await new Promise(resolve => setTimeout(resolve, 10))
  let closed = false
  const closing = client.close().then(() => { closed = true })
  await expect(client.healthy()).rejects.toMatchObject({ code: 'closed' })
  expect(closed).toBe(false); expect(client.stats().active).toBe(1)
  release.resolve(); expect(await operation).toMatchObject({ code: 'unavailable' }); await closing
  expect(client.stats().active).toBe(0)
})

it('requires paired validated native configuration while leaving default local reports unchanged', () => {
  expect(configSchema.parse({})).not.toHaveProperty('nativeReports')
  for (const input of [{ REPORTS_NATIVE_URL: options.baseUrl }, { REPORTS_NATIVE_TOKEN: token }, { REPORTS_NATIVE_URL: options.baseUrl, REPORTS_NATIVE_TOKEN: token },
    { REPORTS_NATIVE_URL: 'https://user:private@example.com/', REPORTS_NATIVE_TOKEN: token }]) expect(configSchema.safeParse(input).success).toBe(false)
  expect(configSchema.parse({ REPORTS_NATIVE_URL: options.baseUrl, REPORTS_NATIVE_TOKEN: token, REPORTS_NATIVE_ALLOW_INSECURE_LOOPBACK: 'true' }).nativeReports)
    .toEqual({ baseUrl: options.baseUrl, token, allowInsecureLoopback: true, timeoutMs: 2000 })
})

it('does not persist a computed result after its job signal loses ownership', async () => {
  const database = await openSqlite({ filename: ':memory:' }), controller = new AbortController(), entered = deferred(), release = deferred()
  try {
    await migrate(database, reportMigrations)
    const handler = reportHandler(database, async () => { entered.resolve(); await release.promise; return { count: 2, sum: 6, min: 2, max: 4 } })
    const work = handler({ numbers: [2, 4] }, { id: 'lost', queue: 'reports.v1', attempt: 1, maxAttempts: 3, signal: controller.signal })
    await entered.promise; controller.abort(); release.resolve(); await work
    expect((await database.execute('SELECT * FROM example_reports')).rows).toHaveLength(0)
  } finally { release.resolve(); await database.close() }
})
