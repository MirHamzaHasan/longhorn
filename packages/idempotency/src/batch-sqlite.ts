import type { BatchDatabase, Migration, SqlStatement, SqlValue } from '@longhornjs/database'
import { IdempotencyConflictError, IdempotencyInputError, idempotencyTime, validIdempotencyKey } from './index.js'
import type { JsonValue } from './index.js'
import { jsonSnapshot } from './json.js'

export type BatchIdempotencyPlan<T extends JsonValue> = {
  readonly statements: readonly SqlStatement[]
  /** The complete response is known before SQL. Computed SELECT results are not JavaScript callbacks. */
  readonly result: T
}
export type BatchIdempotencyOptions = {
  readonly database: BatchDatabase; readonly retentionMs?: number; readonly now?: () => number
  readonly maxInputBytes?: number; readonly maxResultBytes?: number
  readonly maxStatements?: number; readonly maxPlanBytes?: number
}
export class BatchIdempotencyError extends Error {
  constructor(readonly code: 'storage' | 'record') { super('Batch idempotency failed: '+code); this.name='BatchIdempotencyError' }
}
/** Append to a complete batch migration history; never share this ledger with callback stores. */
export const batchIdempotencyMigrations: readonly Migration[] = [{ id:'longhorn_batch_idempotency/001_requests', statements:[
  `CREATE TABLE longhorn_batch_idempotency_requests(
    scope TEXT NOT NULL CHECK(length(scope) BETWEEN 1 AND 200),request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 1 AND 200),
    fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
    claim TEXT NOT NULL UNIQUE CHECK(length(claim)=36),
    result TEXT NOT NULL CHECK(json_valid(result) AND length(CAST(result AS BLOB))<=1048576),
    expires_at INTEGER NOT NULL CHECK(expires_at BETWEEN 0 AND 9007199254740991),PRIMARY KEY(scope,request_key)
  ) STRICT`,
  'CREATE INDEX longhorn_batch_idempotency_expiry ON longhorn_batch_idempotency_requests(expires_at,scope,request_key)',
] }]
const encoder=new TextEncoder()
function bounded(value:number,maximum:number):number {
  if(!Number.isSafeInteger(value)||value<1||value>maximum)throw new IdempotencyInputError('Invalid batch idempotency limit')
  return value
}
function snapshot(plan:readonly SqlStatement[],maximum:number,maxBytes:number):readonly SqlStatement[]{
  if(!Array.isArray(plan)||!plan.length||plan.length>maximum)throw new IdempotencyInputError('Invalid batch idempotency plan')
  let bytes=0
  const charge=(size:number)=>{bytes+=size;if(bytes>maxBytes)throw new IdempotencyInputError('Batch idempotency plan exceeds byte limit')}
  return Array.from(plan,statement=>{
    const sql=typeof statement==='string'?statement:statement?.sql
    if(typeof sql!=='string'||!sql.trim()||sql.length>65536||sql.includes('\0')||/[\uD800-\uDFFF]/u.test(sql))throw new IdempotencyInputError('Invalid batch idempotency SQL')
    const size=encoder.encode(sql).byteLength;if(size>65536)throw new IdempotencyInputError('Invalid batch idempotency SQL');charge(size)
    const source=typeof statement==='string'?[]:statement.args??[]
    if(!Array.isArray(source)||source.length>100)throw new IdempotencyInputError('Invalid batch idempotency arguments')
    const args=Array.from(source,(value:SqlValue):SqlValue=>{
      if(value===null||typeof value==='boolean'){charge(1);return value}
      if(typeof value==='number'&&Number.isFinite(value)&&(!Number.isInteger(value)||Number.isSafeInteger(value))){charge(8);return value}
      if(typeof value==='bigint'&&value>=BigInt(Number.MIN_SAFE_INTEGER)&&value<=BigInt(Number.MAX_SAFE_INTEGER)){charge(8);return value}
      if(typeof value==='string'&&value.length<=maxBytes&&!/[\uD800-\uDFFF]/u.test(value)){charge(encoder.encode(value).byteLength);return value}
      if(value instanceof Uint8Array){charge(value.byteLength);return new Uint8Array(value)}
      throw new IdempotencyInputError('Invalid batch idempotency arguments')
    })
    return {sql,args}
  })
}
/** Borrows an atomic SQLite batch provider. No callback transaction, mutable retry loop, timer or connection. */
export class BatchIdempotency {
  private readonly database:BatchDatabase
  private readonly retentionMs:number
  private readonly now:()=>number
  private readonly inputBytes:number
  private readonly resultBytes:number
  private readonly statements:number
  private readonly planBytes:number
  constructor(options:BatchIdempotencyOptions){
    if(options.database?.dialect!=='sqlite'||typeof options.database.batch!=='function')throw new IdempotencyInputError('SQLite batch database is required')
    this.database=options.database;this.now=options.now??Date.now
    this.retentionMs=bounded(options.retentionMs??86400000,2592000000)
    this.inputBytes=bounded(options.maxInputBytes??16384,1048576);this.resultBytes=bounded(options.maxResultBytes??65536,1048576)
    this.statements=bounded(options.maxStatements??32,998);this.planBytes=bounded(options.maxPlanBytes??262144,16777216)
  }
  async run<T extends JsonValue>(request:{readonly scope:string;readonly key:string;readonly input:JsonValue},plan:BatchIdempotencyPlan<T>):Promise<{readonly value:T;readonly replayed:boolean;readonly expiresAt:number}>{
    const {scope,key}=request
    if(typeof scope!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(scope)||!validIdempotencyKey(key))throw new IdempotencyInputError('Invalid batch idempotency scope or key')
    if(!plan||typeof plan!=='object')throw new IdempotencyInputError('Invalid batch idempotency plan')
    // Snapshot all caller-owned data before hashing yields, including the proposed response and blobs.
    const input=jsonSnapshot(request.input,this.inputBytes),result=jsonSnapshot(plan.result,this.resultBytes),statements=snapshot(plan.statements,this.statements,this.planBytes)
    const digest=await crypto.subtle.digest('SHA-256',encoder.encode(input)),fingerprint=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')
    const at=idempotencyTime(this.now),expiresAt=at+this.retentionMs,claim=crypto.randomUUID()
    if(!Number.isSafeInteger(expiresAt))throw new IdempotencyInputError('Invalid batch idempotency expiry')
    try{
      await this.database.batch([
        {sql:'DELETE FROM longhorn_batch_idempotency_requests WHERE scope=? AND request_key=? AND expires_at<=?',args:[scope,key,at]},
        {sql:'INSERT INTO longhorn_batch_idempotency_requests(scope,request_key,fingerprint,claim,result,expires_at) VALUES(?,?,?,?,?,?)',args:[scope,key,fingerprint,claim,result,expiresAt]},
        ...statements,
      ])
    }catch{
      // A duplicate claim, lost acknowledgement or post-commit decoder error can all reach here.
      // Read positive committed evidence; never blindly resubmit the business plan.
      let rows
      try{rows=(await this.database.execute({sql:'SELECT fingerprint,claim,result,expires_at FROM longhorn_batch_idempotency_requests WHERE scope=? AND request_key=? LIMIT 1',args:[scope,key]})).rows}
      catch{throw new BatchIdempotencyError('storage')}
      if(!rows.length)throw new BatchIdempotencyError('storage')
      const row=rows[0]!,expiry=typeof row.expires_at==='bigint'?Number(row.expires_at):row.expires_at
      if(rows.length!==1||typeof expiry!=='number'||!Number.isSafeInteger(expiry)||expiry<0||typeof row.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(row.fingerprint)||typeof row.claim!=='string'||!/^[a-f0-9-]{36}$/.test(row.claim))throw new BatchIdempotencyError('record')
      if(expiry<=at)throw new BatchIdempotencyError('storage')
      if(row.fingerprint!==fingerprint)throw new IdempotencyConflictError()
      let value:T
      try{
        if(typeof row.result!=='string'||encoder.encode(row.result).byteLength>this.resultBytes)throw new Error()
        value=JSON.parse(jsonSnapshot(JSON.parse(row.result),this.resultBytes)) as T
      }catch{throw new BatchIdempotencyError('record')}
      return {value,replayed:row.claim!==claim,expiresAt:expiry}
    }
    return {value:JSON.parse(result) as T,replayed:false,expiresAt}
  }
  async prune(limit=100):Promise<number>{
    const count=bounded(limit,10000),at=idempotencyTime(this.now)
    try{
      const result=await this.database.execute({sql:`DELETE FROM longhorn_batch_idempotency_requests WHERE (scope,request_key) IN (
        SELECT scope,request_key FROM longhorn_batch_idempotency_requests WHERE expires_at<=? ORDER BY expires_at,scope,request_key LIMIT ?
      )`,args:[at,count]})
      if(!Number.isSafeInteger(result.rowsAffected)||result.rowsAffected<0||result.rowsAffected>count)throw new Error()
      return result.rowsAffected
    }catch{throw new BatchIdempotencyError('storage')}
  }
}
