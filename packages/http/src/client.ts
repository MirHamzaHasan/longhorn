export type JsonClientOptions = {
  /** HTTPS base ending in /. Explicit loopback HTTP is available for local development. */
  readonly baseUrl: string
  readonly token: string
  readonly allowInsecureLoopback?: boolean
  readonly timeoutMs?: number
  readonly maxRequestBytes?: number
  readonly maxResponseBytes?: number
  readonly maxConcurrent?: number
  /** Must honor AbortSignal. Ownership is retained until the actual transport settles. */
  readonly fetch?: typeof globalThis.fetch
}
export type JsonClientFailure = 'capacity' | 'request' | 'request-too-large' | 'response-too-large' | 'timeout' | 'cancelled' | 'network' | 'protocol'
export class JsonClientError extends Error {
  constructor(readonly code: JsonClientFailure) { super('JSON service request failed: '+code); this.name='JsonClientError' }
}
const loopback = new Set(['localhost','127.0.0.1','[::1]'])
export function serviceBaseUrl(value: string, allowInsecureLoopback = false): string {
  let url: URL
  try { url=new URL(value) } catch { throw new Error('Invalid service base URL') }
  if (!url.hostname || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/') ||
    (url.protocol!=='https:' && !(allowInsecureLoopback && url.protocol==='http:' && loopback.has(url.hostname)))) throw new Error('Invalid service base URL')
  return url.href
}
function bounded(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value<1 || value>maximum) throw new Error('Invalid JSON client '+name)
  return value
}

/** Explicit credentials, same-base paths, bounded JSON and one attempt per call. No ambient config or logging. */
export function createJsonClient(options: JsonClientOptions) {
  const base=serviceBaseUrl(options.baseUrl,options.allowInsecureLoopback),token=options.token
  if (typeof token!=='string' || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('Invalid service credential')
  const timeout=bounded(options.timeoutMs??5000,'timeout',60000),requestLimit=bounded(options.maxRequestBytes??65536,'request bytes',1048576)
  const responseLimit=bounded(options.maxResponseBytes??16384,'response bytes',1048576),maximum=bounded(options.maxConcurrent??16,'concurrency',1024)
  const send=options.fetch??globalThis.fetch
  if (typeof send!=='function') throw new Error('Fetch is required')
  let active=0
  return Object.freeze({
    async request(path: string, input: { readonly method?: 'GET' | 'POST'; readonly value?: unknown; readonly signal?: AbortSignal } = {}): Promise<{ readonly status: number; readonly data: unknown }> {
      if (typeof path!=='string' || path.length>512 || !/^[A-Za-z0-9_~./-]*$/.test(path) || path.startsWith('/') || path.split('/').some(part=>part==='.'||part==='..')) throw new JsonClientError('request')
      if (active>=maximum) throw new JsonClientError('capacity')
      let body: string | undefined
      if (input.value!==undefined) {
        try { body=JSON.stringify(input.value) } catch { throw new JsonClientError('request') }
        if (body===undefined) throw new JsonClientError('request')
        if (new TextEncoder().encode(body).byteLength>requestLimit) throw new JsonClientError('request-too-large')
      }
      const method=input.method??'GET'
      if (!['GET','POST'].includes(method) || (method==='GET' && body!==undefined)) throw new JsonClientError('request')
      const controller=new AbortController();let expired=false,reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      const cancelReader=()=>{if(reader)void reader.cancel().catch(()=>{})}
      const cancel=()=>{controller.abort();cancelReader()}
      const timer=setTimeout(()=>{expired=true;cancel()},timeout)
      input.signal?.addEventListener('abort',cancel,{once:true})
      if (input.signal?.aborted) cancel()
      const aborted=()=>{if(controller.signal.aborted)throw new JsonClientError(expired?'timeout':'cancelled')}
      active++
      try {
        aborted()
        const response=await send(base+path,{method,headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body}),signal:controller.signal,redirect:'manual',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'})
        if (!response.body) { aborted();throw new JsonClientError('protocol') }
        reader=response.body.getReader()
        aborted()
        if (response.status>=300 && response.status<400) throw new JsonClientError('protocol')
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type')??'')) throw new JsonClientError('protocol')
        const chunks: Uint8Array[]=[];let size=0
        while(true){
          aborted();const part=await reader.read();if(part.done)break
          size+=part.value.byteLength;if(size>responseLimit)throw new JsonClientError('response-too-large');chunks.push(part.value)
        }
        aborted()
        const bytes=new Uint8Array(size);let offset=0
        for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
        let data: unknown
        try { data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) } catch { throw new JsonClientError('protocol') }
        return {status:response.status,data}
      } catch(error) {
        if (controller.signal.aborted) throw new JsonClientError(expired?'timeout':'cancelled')
        if (error instanceof JsonClientError) throw error
        throw new JsonClientError('network')
      } finally {
        clearTimeout(timer);input.signal?.removeEventListener('abort',cancel)
        if(reader){try{await reader.cancel()}catch{};reader.releaseLock()}
        active--
      }
    },
  })
}
