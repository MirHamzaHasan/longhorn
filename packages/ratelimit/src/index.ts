import { bounded,clock,RateLimitError,reservation } from './protocol.js'
import type { RateLimitStorage,RateLimitStore,ServerTimedRateLimitStore,RateLimitDecision } from './types.js'
export { RateLimitError } from './protocol.js'
export type { RateLimitFailure } from './protocol.js'
export type { RateLimitStore,RateLimitStorage,ServerTimedRateLimitStore,ServerTimedRateLimit,RateLimitDecision,RateLimitReservation,StoredRateLimit } from './types.js'

/** Counts attempts in per-subject fixed windows. The host owns its store/database. */
export class RateLimiter {
  readonly scope: string
  readonly limit: number
  readonly windowMs: number
  private readonly store: RateLimitStorage
  private readonly serverClock: boolean
  private readonly now: () => number
  private readonly active=new Set<Promise<void>>()
  private stopping=false
  private closing:Promise<void>|undefined
  constructor(options:{readonly store:RateLimitStorage;readonly scope:string;readonly limit?:number;readonly windowMs?:number;readonly now?:()=>number}){
    const policy=reservation({scope:options.scope,key:'0'.repeat(64),limit:options.limit??60,windowMs:options.windowMs??60_000})
    if(typeof options.store?.consume!=='function'||typeof options.store.prune!=='function'||(options.store.clock!==undefined&&options.store.clock!=='application'&&options.store.clock!=='server')||(options.now!==undefined&&(typeof options.now!=='function'||options.store.clock==='server')))throw new RateLimitError('INPUT')
    this.scope=policy.scope;this.limit=policy.limit;this.windowMs=policy.windowMs;this.store=options.store;this.serverClock=options.store.clock==='server';this.now=options.now??Date.now
  }
  private admit<T>(work:()=>Promise<T>):Promise<T>{
    if(this.stopping)return Promise.reject(new RateLimitError('CLOSED'))
    const result=Promise.resolve().then(work),settled=result.then(()=>{},()=>{})
    this.active.add(settled);void settled.then(()=>{this.active.delete(settled)})
    return result
  }
  consume(subject:string):Promise<RateLimitDecision>{
    // The primitive subject is captured before admission's first asynchronous step.
    return this.admit(async()=>{
      if(typeof subject!=='string'||subject.length<1||subject.length>1024||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(subject))throw new RateLimitError('INPUT')
      const bytes=new TextEncoder().encode(subject);if(bytes.byteLength>1024)throw new RateLimitError('INPUT')
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['longhorn.rate-limit.v1',this.scope,subject]))),key=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')
      let sampled:number|undefined
      const input=Object.freeze({scope:this.scope,key,limit:this.limit,windowMs:this.windowMs})
      const result=this.serverClock?await (this.store as ServerTimedRateLimitStore).consume(input):await (this.store as RateLimitStore).consume(input,()=>{
        if(sampled!==undefined)throw new RateLimitError('PROTOCOL')
        sampled=clock(this.now);if(!Number.isSafeInteger(sampled+this.windowMs))throw new RateLimitError('INPUT');return sampled
      })
      if(this.serverClock){
        const time=(result as {observedAt?:unknown})?.observedAt
        if(typeof time!=='number'||!Number.isSafeInteger(time)||time<0||!Number.isSafeInteger(time+this.windowMs))throw new RateLimitError('PROTOCOL')
        sampled=time
      }
      if(sampled===undefined||typeof result?.allowed!=='boolean'||!Number.isSafeInteger(result.remaining)||result.remaining<0||result.remaining>=this.limit||(!result.allowed&&result.remaining!==0)||!Number.isSafeInteger(result.resetsAt)||result.resetsAt<=sampled)throw new RateLimitError('PROTOCOL')
      return Object.freeze({allowed:result.allowed,remaining:result.remaining,resetsAt:result.resetsAt,retryAfterMs:result.allowed?0:result.resetsAt-sampled})
    })
  }
  prune(limit=100):Promise<number>{return this.admit(async()=>{
    const maximum=bounded(limit,10_000),removed=this.serverClock?await (this.store as ServerTimedRateLimitStore).prune({limit:maximum}):await (this.store as RateLimitStore).prune({now:clock(this.now),limit:maximum})
    if(!Number.isSafeInteger(removed)||removed<0||removed>maximum)throw new RateLimitError('PROTOCOL')
    return removed
  })}
  close():Promise<void>{
    if(!this.closing){this.stopping=true;this.closing=Promise.all([...this.active]).then(()=>{})}
    return this.closing
  }
}
