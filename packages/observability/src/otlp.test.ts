import { expect,it,vi } from 'vitest'
import { OtlpHttpSpanExporter,parseOtlpHeaders } from './otlp.js'
import type { OtlpHttpExporterOptions } from './otlp.js'
import { Tracer } from './tracing.js'
import type { SpanRecord } from './tracing.js'
const endpoint='http://127.0.0.1:4318/v1/traces'
const record=(): SpanRecord => ({ name: 'GET /items/:id',kind: 'server',context: { traceId: '1'.repeat(32),spanId: '2'.repeat(16),sampled: true },
  parentSpanId: '3'.repeat(16),startedAt: 1792760000000,endedAt: 1792760000001,durationMs: 1,status: 'ok',attributes: { 'http.route': '/items/:id',integer: 42,ratio: 1.5,yes: true } })
const ok=(value: unknown={}) => new Response(JSON.stringify(value),{ headers: { 'Content-Type': 'application/json' } })
const options=(fetch: typeof globalThis.fetch,extra: Partial<OtlpHttpExporterOptions>={}) => ({ endpoint,serviceName: 'native-test',fetch,initialRetryDelayMs: 1,maxRetryDelayMs: 4,...extra })
function deferred<T>() { let resolve!: (value: T) => void;const promise=new Promise<T>(done => { resolve=done });return { resolve,promise } }

it('encodes OTLP JSON IDs/enums/exact timestamp strings/scalars and snapshots resource/header/span input',async () => {
  const calls: RequestInit[]=[],headers={ authorization: 'Bearer private-test' },resource={ 'deployment.environment.name': 'test' }
  const exporter=new OtlpHttpSpanExporter(options(async (_url,init) => { calls.push(init!);return ok() },{ headers,resourceAttributes: resource,serviceVersion: '1.0' }))
  headers.authorization='changed';resource['deployment.environment.name']='changed'
  const input=record(),pending=exporter.export([input]);(input as { name: string }).name='changed';await pending
  const request=calls[0]!,json=JSON.parse(String(request.body)),rs=json.resourceSpans[0],scope=rs.scopeSpans[0],span=scope.spans[0]
  expect(rs.resource.attributes).toContainEqual({ key: 'service.name',value: { stringValue: 'native-test' } })
  expect(rs.resource.attributes).toContainEqual({ key: 'deployment.environment.name',value: { stringValue: 'test' } })
  expect(scope.scope.name).toBe('@longhorn/observability')
  expect(span).toMatchObject({ name: 'GET /items/:id',traceId: '1'.repeat(32),spanId: '2'.repeat(16),parentSpanId: '3'.repeat(16),kind: 2,flags: 1,
    startTimeUnixNano: '1792760000000000000',endTimeUnixNano: '1792760000001000000',status: { code: 1 } })
  expect(span.attributes).toContainEqual({ key: 'integer',value: { intValue: '42' } })
  expect(span.attributes).toContainEqual({ key: 'ratio',value: { doubleValue: 1.5 } })
  expect(span.attributes).toContainEqual({ key: 'yes',value: { boolValue: true } })
  expect(new Headers(request.headers).get('authorization')).toBe('Bearer private-test')
  expect(request).toMatchObject({ method: 'POST',redirect: 'manual',credentials: 'omit',cache: 'no-store' })
  expect(exporter.stats()).toMatchObject({ active: false,pendingTransports: 0,requests: 1,acceptedSpans: 1 })
  await exporter.close()
})
it('validates records and bounds span count and UTF-8 envelope bytes before network admission',async () => {
  const fetch=vi.fn(async () => ok()),exporter=new OtlpHttpSpanExporter(options(fetch,{ maxSpansPerBatch: 1,maxRequestBytes: 512 }))
  await expect(exporter.export([record(),record()])).rejects.toMatchObject({ code: 'request-too-large' })
  await expect(exporter.export([{ ...record(),context: { ...record().context,traceId: '0'.repeat(32) } }])).rejects.toMatchObject({ code: 'invalid-input' })
  await expect(exporter.export([{ ...record(),endedAt: 19_000_000_000_000 }])).rejects.toMatchObject({ code: 'invalid-input' })
  await expect(exporter.export([{ ...record(),attributes: { message: '界'.repeat(256) } }])).rejects.toMatchObject({ code: 'request-too-large' })
  expect(fetch).not.toHaveBeenCalled();await exporter.close()
})
it('rejects overlapping exports without a queue and drains an accepted batch before memoized close',async () => {
  const gate=deferred<Response>(),exporter=new OtlpHttpSpanExporter(options(async () => gate.promise))
  const accepted=exporter.export([record()]);await expect(exporter.export([record()])).rejects.toMatchObject({ code: 'busy' })
  const closing=exporter.close();expect(exporter.close()).toBe(closing)
  await expect(exporter.export([record()])).rejects.toMatchObject({ code: 'closed' })
  expect(exporter.stats().closed).toBe(false);gate.resolve(ok());await accepted;await closing
  expect(exporter.stats()).toMatchObject({ closed: true,acceptedSpans: 1 })
})
it('retries only transient HTTP/network failures with the same serialized batch',async () => {
  const bodies: unknown[]=[],fetch=vi.fn(async (_url: RequestInfo | URL,init?: RequestInit) => {
    bodies.push(init!.body)
    if (bodies.length===1) return new Response('private response',{ status: 429,headers: { 'Retry-After': 'invalid' } })
    if (bodies.length===2) throw new Error('private endpoint/headers')
    if (bodies.length===3) return new Response('',{ status: 503,headers: { 'Retry-After': '0' } })
    return ok()
  })
  const exporter=new OtlpHttpSpanExporter(options(fetch,{ maxAttempts: 4 }))
  await exporter.export([record()]);expect(new Set(bodies).size).toBe(1)
  expect(exporter.stats()).toMatchObject({ requests: 4,retries: 3,acceptedSpans: 1 });await exporter.close()
})
it('does not retry permanent status/redirect errors or expose endpoint/header/response secrets',async () => {
  for (const status of [301,400,401,404,500,501]) {
    const fetch=vi.fn(async () => new Response('response-secret',{ status }))
    const exporter=new OtlpHttpSpanExporter(options(fetch,{ endpoint: 'https://private-collector.example/v1/traces',headers: { authorization: 'header-secret' } }))
    const error=await exporter.export([record()]).catch(error => error)
    expect(error).toMatchObject({ code: 'http',statusCode: status });expect(fetch).toHaveBeenCalledTimes(1)
    for (const secret of ['private-collector','header-secret','response-secret']) expect(String(error)+JSON.stringify(error)).not.toContain(secret)
    await exporter.close()
  }
})
it('does not retry partial acceptance and distinguishes accepted/rejected spans from warnings',async () => {
  const fetch=vi.fn(async () => ok({ partialSuccess: { rejectedSpans: '1',errorMessage: 'private server detail' } }))
  const exporter=new OtlpHttpSpanExporter(options(fetch))
  const error=await exporter.export([record(),record()]).catch(error => error)
  expect(error).toMatchObject({ code: 'partial',rejectedSpans: 1 });expect(String(error)).not.toContain('private server detail')
  expect(fetch).toHaveBeenCalledTimes(1);expect(exporter.stats()).toMatchObject({ acceptedSpans: 1,rejectedSpans: 1,partialResponses: 1,warnings: 1 })
  await exporter.close()
  const warning=new OtlpHttpSpanExporter(options(async () => ok({ partialSuccess: { rejectedSpans: 0,errorMessage: 'warning' },futureField: true })))
  await warning.export([record()]);expect(warning.stats()).toMatchObject({ acceptedSpans: 1,warnings: 1,failedBatches: 0 });await warning.close()
})
it('bounds response reading and rejects malformed acknowledgements without retry',async () => {
  for (const response of [new Response('x'.repeat(64),{ headers: { 'Content-Type': 'application/json' } }),ok([]),ok({ partialSuccess: { rejectedSpans: '2' } }),
    new Response('{}',{ headers: { 'Content-Type': 'application/x-protobuf' } })]) {
    const fetch=vi.fn(async () => response),exporter=new OtlpHttpSpanExporter(options(fetch,{ maxResponseBytes: 32 }))
    await expect(exporter.export([record()])).rejects.toMatchObject({ name: 'OtlpExportError' });expect(fetch).toHaveBeenCalledTimes(1);await exporter.close()
  }
})
it('bounds the whole batch deadline and quarantines an uncooperative fetch after timeout',async () => {
  const gate=deferred<Response>(),fetch=vi.fn(async () => gate.promise),exporter=new OtlpHttpSpanExporter(options(fetch,{ timeoutMs: 20 }))
  await expect(exporter.export([record()])).rejects.toMatchObject({ code: 'timeout' })
  expect(exporter.stats()).toMatchObject({ active: false,pendingTransports: 1,requests: 1 })
  await expect(exporter.export([record()])).rejects.toMatchObject({ code: 'busy' })
  await exporter.close();expect(exporter.stats().closed).toBe(true)
  gate.resolve(ok());await vi.waitFor(() => expect(exporter.stats().pendingTransports).toBe(0))
  expect(exporter.stats().acceptedSpans).toBe(0);expect(fetch).toHaveBeenCalledTimes(1)
})
it('aborts stalled response bodies and honors Retry-After without exceeding the batch budget',async () => {
  let cancelled=false
  const stalled=new Response(new ReadableStream({ start: controller => { controller.enqueue(new TextEncoder().encode('{')) },cancel: () => { cancelled=true } }),{ headers: { 'Content-Type': 'application/json' } })
  const exporter=new OtlpHttpSpanExporter(options(async () => stalled,{ timeoutMs: 20 }))
  await expect(exporter.export([record()])).rejects.toMatchObject({ code: 'timeout' });expect(cancelled).toBe(true);await exporter.close()
  for (const value of ['100',new Date(Date.now()+100000).toUTCString()]) {
    const fetch=vi.fn(async () => new Response('',{ status: 503,headers: { 'Retry-After': value } })),limited=new OtlpHttpSpanExporter(options(fetch,{ timeoutMs: 100 }))
    await expect(limited.export([record()])).rejects.toMatchObject({ code: 'timeout' });expect(fetch).toHaveBeenCalledTimes(1);await limited.close()
  }
})
it('isolates remote failure from business results through the existing Tracer lifecycle',async () => {
  const exporter=new OtlpHttpSpanExporter(options(async () => new Response('',{ status: 503 }),{ maxAttempts: 1 })),tracer=new Tracer({ exporter })
  expect(await tracer.trace('business',() => 42)).toBe(42)
  const original=new Error('business failure');await expect(tracer.trace('failed',() => { throw original })).rejects.toBe(original)
  await tracer.close();expect(tracer.snapshot()).toMatchObject({ closed: true,exportErrors: 2,dropped: 2 })
})
it('parses explicit OTEL-style headers and rejects ambiguous/reserved/unsafe configuration without values in errors',() => {
  expect(parseOtlpHeaders('authorization=Bearer%20secret%3Dvalue,x-api-key=two')).toEqual({ authorization: 'Bearer secret=value','x-api-key': 'two' })
  for (const value of ['authorization=secret;metadata=x','a=one,A=two','a=%0Asecret','a=%ZZ','content-type=secret']) expect(() => parseOtlpHeaders(value)).toThrow()
  for (const invalid of ['https://user:secret@host/v1/traces','https://host/v1/traces?token=secret','file:///secret']) {
    try { new OtlpHttpSpanExporter(options(async () => ok(),{ endpoint: invalid }));throw new Error('Expected failure') }
    catch (error) { expect(String(error)).not.toContain('secret') }
  }
})
