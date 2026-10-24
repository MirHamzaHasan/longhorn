export type OtlpFailure = 'closed' | 'busy' | 'invalid-input' | 'request-too-large' | 'timeout' | 'network' | 'http' | 'protocol' | 'response-too-large' | 'partial'
export class OtlpDeliveryError extends Error {
  constructor(readonly code: OtlpFailure,readonly statusCode?: number,readonly rejectedItems?: number) {
    super(`OTLP export failed: ${code}`);this.name='OtlpDeliveryError'
  }
}
export type OtlpHttpDeliveryOptions = {
  readonly rejectedField: 'rejectedSpans' | 'rejectedDataPoints' | 'rejectedLogRecords'
  /** Exact signal URL, e.g. http://127.0.0.1:4318/v1/traces. No ambient environment is read. */
  readonly endpoint: string
  readonly headers?: Readonly<Record<string,string>>
  /** Total deadline for a batch, including response reading and retry delays. */
  readonly timeoutMs?: number
  readonly maxAttempts?: number
  readonly initialRetryDelayMs?: number
  readonly maxRetryDelayMs?: number
  readonly maxRequestBytes?: number
  readonly maxResponseBytes?: number
  /** Must honor AbortSignal. A timed-out uncooperative transport keeps admission busy until settled. */
  readonly fetch?: typeof globalThis.fetch
}
const retryable=new Set([429,502,503,504])
const reserved=new Set(['content-type','content-length','host','connection','accept','accept-encoding','transfer-encoding','cookie','set-cookie','proxy-authorization','proxy-connection','trailer','upgrade','te','keep-alive'])
function header(name: string,value: string): void {
  if (reserved.has(name.toLowerCase()) || name.length>128 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value!=='string' || value.length>4096 || /[^\x20-\x7e]/.test(value)) throw new Error('Invalid OTLP header')
}
/** Explicit OTEL-style comma-separated key=value configuration, with percent-encoded values. */
export function parseOtlpHeaders(value: string): Readonly<Record<string,string>> {
  if (typeof value!=='string' || value.length>65536) throw new Error('Invalid OTLP headers')
  const result: Record<string,string>=Object.create(null),names=new Set<string>()
  if (!value.trim()) return Object.freeze(result)
  for (const part of value.split(',')) {
    const separator=part.indexOf('=')
    if (separator<1 || part.includes(';')) throw new Error('Invalid OTLP headers')
    const name=part.slice(0,separator).trim();let decoded: string
    try { decoded=decodeURIComponent(part.slice(separator+1).trim()) } catch { throw new Error('Invalid OTLP headers') }
    header(name,decoded)
    if (names.has(name.toLowerCase()) || names.size>=32) throw new Error('Duplicate or excessive OTLP headers')
    names.add(name.toLowerCase());result[name]=decoded
  }
  return Object.freeze(result)
}
export function otlpInteger(value: number,name: string,min: number,max: number) {
  if (!Number.isSafeInteger(value) || value<min || value>max) throw new Error(`Invalid OTLP ${name}`)
  return value
}
const discard=(response: Response) => { try { void response.body?.cancel().catch(() => {}) } catch { /* Never expose transport diagnostics. */ } }
function delay(ms: number,signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new OtlpDeliveryError('timeout'))
  return new Promise((resolve,reject) => {
    const done=() => { clearTimeout(timer);signal.removeEventListener('abort',aborted);resolve() }
    const aborted=() => { clearTimeout(timer);signal.removeEventListener('abort',aborted);reject(new OtlpDeliveryError('timeout')) }
    const timer=setTimeout(done,ms);signal.addEventListener('abort',aborted,{ once: true })
  })
}
function retryAfter(value: string | null): number {
  if (!value || value.length>256) return 0
  if (/^\d+$/.test(value)) return Number(value)*1000
  const ms=Date.parse(value)-Date.now()
  return Number.isFinite(ms) ? Math.max(0,ms) : 0
}
async function body(response: Response,signal: AbortSignal,maximum: number): Promise<unknown> {
  if (!response.body) throw new OtlpDeliveryError('protocol')
  const reader=response.body.getReader(),chunks: Uint8Array[]=[];let size=0
  const aborted=() => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort',aborted,{ once: true })
  try {
    while (true) {
      if (signal.aborted) throw new OtlpDeliveryError('timeout')
      const item=await reader.read()
      if (item.done) break
      size+=item.value.byteLength
      if (size>maximum) throw new OtlpDeliveryError('response-too-large')
      chunks.push(item.value)
    }
    if (signal.aborted) throw new OtlpDeliveryError('timeout')
    const bytes=new Uint8Array(size);let offset=0
    for (const chunk of chunks) { bytes.set(chunk,offset);offset+=chunk.byteLength }
    try { return JSON.parse(new TextDecoder('utf-8',{ fatal: true }).decode(bytes)) }
    catch { throw new OtlpDeliveryError('protocol') }
  } finally {
    signal.removeEventListener('abort',aborted)
    try { void reader.cancel().catch(() => {});reader.releaseLock() } catch { /* Deadline still bounds the export Promise. */ }
  }
}
function acknowledgement(value: unknown,count: number,field: 'rejectedSpans' | 'rejectedDataPoints' | 'rejectedLogRecords'): { partial: boolean;rejected: number;warning: boolean } {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new OtlpDeliveryError('protocol')
  const partial=(value as Record<string,unknown>).partialSuccess
  if (partial===undefined) return { partial: false,rejected: 0,warning: false }
  if (!partial || typeof partial!=='object' || Array.isArray(partial)) throw new OtlpDeliveryError('protocol')
  const { [field]: rejectedItems=0,errorMessage='' }=partial as Record<string,unknown>
  if ((typeof rejectedItems!=='number' && typeof rejectedItems!=='string') || !/^\d+$/.test(String(rejectedItems)) || typeof errorMessage!=='string') throw new OtlpDeliveryError('protocol')
  const rejected=Number(rejectedItems)
  if (!Number.isSafeInteger(rejected) || rejected<0 || rejected>count) throw new OtlpDeliveryError('protocol')
  return { partial: true,rejected,warning: errorMessage.length>0 }
}

/** Shared signal-neutral HTTP ownership; wrappers own serialization and public error metadata. */
export class OtlpHttpDelivery {
  private readonly rejectedField: 'rejectedSpans' | 'rejectedDataPoints' | 'rejectedLogRecords'
  private readonly endpoint: string
  private readonly headers: Headers
  private readonly send: typeof globalThis.fetch
  private readonly timeoutMs: number
  private readonly maxAttempts: number
  private readonly initialDelay: number
  private readonly maximumDelay: number
  readonly requestBytes: number
  private readonly responseBytes: number
  private active: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private closed=false
  private pendingTransports=0
  private requests=0
  private retries=0
  private acceptedItems=0
  private rejectedItems=0
  private failedBatches=0
  private partialResponses=0
  private warnings=0
  constructor(options: OtlpHttpDeliveryOptions) {
    let endpoint: URL
    try { endpoint=new URL(options.endpoint) } catch { throw new Error('Invalid OTLP endpoint') }
    if (!['http:','https:'].includes(endpoint.protocol) || !endpoint.hostname || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Invalid OTLP endpoint')
    this.rejectedField=options.rejectedField
    this.endpoint=endpoint.href
    this.headers=new Headers({ 'Content-Type': 'application/json',Accept: 'application/json' })
    const entries=Object.entries(options.headers ?? {})
    if (entries.length>32) throw new Error('OTLP header capacity exceeded')
    const names=new Set<string>()
    for (const [name,value] of entries) {
      header(name,value)
      if (names.has(name.toLowerCase())) throw new Error('Duplicate OTLP header')
      names.add(name.toLowerCase())
      this.headers.set(name,value)
    }
    this.timeoutMs=otlpInteger(options.timeoutMs ?? 10000,'timeoutMs',1,60000)
    this.maxAttempts=otlpInteger(options.maxAttempts ?? 3,'maxAttempts',1,5)
    this.initialDelay=otlpInteger(options.initialRetryDelayMs ?? 200,'initialRetryDelayMs',1,60000)
    this.maximumDelay=otlpInteger(options.maxRetryDelayMs ?? 2000,'maxRetryDelayMs',this.initialDelay,60000)
    this.requestBytes=otlpInteger(options.maxRequestBytes ?? 1_048_576,'maxRequestBytes',256,16_777_216)
    this.responseBytes=otlpInteger(options.maxResponseBytes ?? 65_536,'maxResponseBytes',1,4_194_304)
    this.send=options.fetch ?? globalThis.fetch.bind(globalThis)
  }
  stats() {
    return { active: this.active!==undefined,pendingTransports: this.pendingTransports,requests: this.requests,retries: this.retries,
      acceptedItems: this.acceptedItems,rejectedItems: this.rejectedItems,failedBatches: this.failedBatches,
      partialResponses: this.partialResponses,warnings: this.warnings,closing: this.closing!==undefined,closed: this.closed }
  }
  export(serialize: () => { payload: string;count: number } | undefined): Promise<void> {
    if (this.closing) return Promise.reject(new OtlpDeliveryError('closed'))
    if (this.active || this.pendingTransports) return Promise.reject(new OtlpDeliveryError('busy'))
    let item: ReturnType<typeof serialize>
    try { item=serialize() }
    catch (error) { return Promise.reject(new OtlpDeliveryError(error instanceof RangeError ? 'request-too-large' : 'invalid-input')) }
    if (!item) return Promise.resolve()
    const { payload,count }=item
    const controller=new AbortController(),deadline=performance.now()+this.timeoutMs
    let timer: ReturnType<typeof setTimeout>
    const expired=new Promise<never>((_,reject) => { timer=setTimeout(() => { controller.abort();reject(new OtlpDeliveryError('timeout')) },this.timeoutMs) })
    const work=Promise.resolve().then(() => this.deliver(payload,count,controller.signal,deadline))
    const operation=Promise.race([work,expired]).catch(error => {
      this.failedBatches++;throw error instanceof OtlpDeliveryError ? error : new OtlpDeliveryError(controller.signal.aborted ? 'timeout' : 'network')
    }).finally(() => { clearTimeout(timer);this.active=undefined })
    this.active=operation;return operation
  }
  private async deliver(payload: string,count: number,signal: AbortSignal,deadline: number): Promise<void> {
    for (let attempt=0;attempt<this.maxAttempts;attempt++) {
      if (signal.aborted || performance.now()>=deadline) throw new OtlpDeliveryError('timeout')
      let wait=0,failure: OtlpDeliveryError | undefined
      this.requests++;this.pendingTransports++
      try {
        const response=await this.send(this.endpoint,{ method: 'POST',headers: new Headers(this.headers),body: payload,signal,
          credentials: 'omit',redirect: 'manual',cache: 'no-store',referrerPolicy: 'no-referrer' })
        if (signal.aborted) { discard(response);throw new OtlpDeliveryError('timeout') }
        if (response.status!==200) {
          wait=retryAfter(response.headers.get('Retry-After'));discard(response)
          failure=new OtlpDeliveryError('http',response.status)
          if (!retryable.has(response.status)) throw failure
        } else {
          if (response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase()!=='application/json') { discard(response);throw new OtlpDeliveryError('protocol') }
          const result=acknowledgement(await body(response,signal,this.responseBytes),count,this.rejectedField)
          this.acceptedItems+=count-result.rejected;this.rejectedItems+=result.rejected
          if (result.partial) this.partialResponses++
          if (result.warning) this.warnings++
          if (result.rejected) throw new OtlpDeliveryError('partial',200,result.rejected)
          return
        }
      } catch (error) {
        if (signal.aborted) throw new OtlpDeliveryError('timeout')
        if (error instanceof OtlpDeliveryError) throw error
        failure=new OtlpDeliveryError('network')
      } finally { this.pendingTransports-- }
      if (attempt+1>=this.maxAttempts) throw failure!
      const backoff=Math.min(this.maximumDelay,this.initialDelay*2**attempt)*(0.5+Math.random()*0.5)
      const pause=Math.max(wait,backoff)
      if (pause>=deadline-performance.now()) throw new OtlpDeliveryError('timeout')
      await delay(pause,signal);this.retries++
    }
  }
  close(): Promise<void> {
    this.closing ??= (async () => { try { await this.active } catch { /* Export failures belong to the export caller. */ } finally { this.closed=true } })()
    return this.closing
  }
}
