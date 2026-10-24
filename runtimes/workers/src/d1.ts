import type { D1Database,D1DatabaseSession,D1PreparedStatement } from '@cloudflare/workers-types'
import type { BatchDatabase,QueryResult,SqlStatement,SqlValue } from '@longhorn/database'
import { d1Sql } from './d1-sql.js'
export type D1Binding=Pick<D1Database|D1DatabaseSession,'prepare'|'batch'>
export type D1Options={readonly maxPending?:number;readonly maxBatchStatements?:number;readonly maxSqlBytes?:number;readonly maxInputBytes?:number;readonly maxResultRows?:number;readonly maxResultBytes?:number}
export type D1Failure='input'|'capacity'|'closed'|'storage'|'protocol'|'precision'|'result-limit'
export class D1Error extends Error {constructor(readonly code:D1Failure){super('D1 operation failed: '+code);this.name='D1Error'}}
export interface D1BatchDatabase extends BatchDatabase {
  readonly dialect:'sqlite'
  stats():{readonly pending:number;readonly operations:number;readonly statements:number;readonly failedOperations:number;readonly closing:boolean;readonly closed:boolean}
}
function limit(value:number,maximum:number):number{if(!Number.isSafeInteger(value)||value<1||value>maximum)throw new RangeError('Invalid D1 limit');return value}
const encoder=new TextEncoder()
/** Borrow a D1 binding/session. Close drains this handle, without closing/deleting the platform database. */
export function createD1(binding:D1Binding,options:D1Options={}):D1BatchDatabase{
  if(typeof binding?.prepare!=='function'||typeof binding.batch!=='function')throw new TypeError('D1 prepare/batch binding is required')
  const maximum=limit(options.maxPending??6,1024),batchLimit=limit(options.maxBatchStatements??40,1000),sqlBytes=limit(options.maxSqlBytes??65536,100000)
  const inputBytes=limit(options.maxInputBytes??1048576,16777216),rowLimit=limit(options.maxResultRows??1000,100000),resultBytes=limit(options.maxResultBytes??1048576,16777216)
  const prepare=binding.prepare.bind(binding),batch=binding.batch.bind(binding),active=new Set<Promise<void>>()
  let closing:Promise<void>|undefined,closed=false,operations=0,statements=0,failedOperations=0
  function snapshot(inputs:readonly SqlStatement[]){
    if(!Array.isArray(inputs)||inputs.length>batchLimit)throw new D1Error('input')
    let bytes=0
    const charge=(size:number)=>{bytes+=size;if(bytes>inputBytes)throw new D1Error('input')}
    return Array.from(inputs,input=>{
      const sql=typeof input==='string'?input:input?.sql
      if(typeof sql!=='string'||!sql.trim()||sql.length>sqlBytes||sql.includes('\0')||/[\uD800-\uDFFF]/u.test(sql))throw new D1Error('input')
      const size=encoder.encode(sql).byteLength;if(size>sqlBytes)throw new D1Error('input');charge(size)
      try{d1Sql(sql)}catch{throw new D1Error('input')}
      const source=typeof input==='string'?[]:input.args??[]
      if(!Array.isArray(source)||source.length>100)throw new D1Error('input')
      const args=Array.from(source,(value:SqlValue):unknown=>{
        if(value===null){charge(1);return null}
        if(typeof value==='boolean'){charge(1);return value?1:0}
        if(typeof value==='number'){if(!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value)))throw new D1Error('input');charge(8);return value}
        if(typeof value==='bigint'){if(value>BigInt(Number.MAX_SAFE_INTEGER)||value<BigInt(Number.MIN_SAFE_INTEGER))throw new D1Error('input');charge(8);return Number(value)}
        if(typeof value==='string'){if(value.length>inputBytes||/[\uD800-\uDFFF]/u.test(value))throw new D1Error('input');charge(encoder.encode(value).byteLength);return value}
        if(value instanceof Uint8Array){charge(value.byteLength);return new Uint8Array(value).buffer}
        throw new D1Error('input')
      })
      return {sql,args}
    })
  }
  function results(raw:unknown,count:number):readonly QueryResult[]{
    if(!Array.isArray(raw)||raw.length!==count)throw new D1Error('protocol')
    let bytes=0,rows=0
    const charge=(size:number)=>{bytes+=size;if(bytes>resultBytes)throw new D1Error('result-limit')}
    const value=(input:unknown):SqlValue=>{
      if(input===null){charge(1);return null}
      if(typeof input==='number'){if(!Number.isFinite(input))throw new D1Error('protocol');if(Number.isInteger(input)&&!Number.isSafeInteger(input))throw new D1Error('precision');charge(8);return input}
      if(typeof input==='string'){charge(encoder.encode(input).byteLength);return input}
      if(typeof input==='boolean'){charge(1);return input}
      if(input instanceof ArrayBuffer){charge(input.byteLength);return new Uint8Array(input.slice(0))}
      if(input instanceof Uint8Array){charge(input.byteLength);return new Uint8Array(input)}
      if(Array.isArray(input)){charge(input.length);if([...input].some(byte=>!Number.isInteger(byte)||byte<0||byte>255))throw new D1Error('protocol');return new Uint8Array(input)}
      throw new D1Error('protocol')
    }
    return raw.map(item=>{
      if(!item||typeof item!=='object'||item.success!==true||!item.meta||!Number.isSafeInteger(item.meta.changes)||item.meta.changes<0||!Array.isArray(item.results))throw new D1Error('protocol')
      rows+=item.results.length;if(rows>rowLimit)throw new D1Error('result-limit')
      const output=item.results.map((row:unknown)=>{
        if(!row||typeof row!=='object'||Array.isArray(row))throw new D1Error('protocol')
        const entries=Object.entries(row);if(entries.length>100)throw new D1Error('protocol')
        return Object.fromEntries(entries.map(([key,item])=>{charge(encoder.encode(key).byteLength);return [key,value(item)]}))
      })
      const id=item.meta.last_row_id
      return {rows:output,rowsAffected:item.meta.changes,lastInsertId:typeof id==='number'&&Number.isSafeInteger(id)&&id!==0?BigInt(id):undefined}
    })
  }
  function run(inputs:readonly SqlStatement[]):Promise<readonly QueryResult[]>{
    if(closing)return Promise.reject(new D1Error('closed'))
    if(active.size>=maximum)return Promise.reject(new D1Error('capacity'))
    let values:ReturnType<typeof snapshot>
    try{values=snapshot(inputs)}catch{return Promise.reject(new D1Error('input'))}
    if(!values.length)return Promise.resolve([])
    operations++;statements+=values.length
    const operation=Promise.resolve().then(async()=>{
      try{
        const prepared:D1PreparedStatement[]=values.map(value=>prepare(value.sql).bind(...value.args))
        return results(await batch(prepared),values.length)
      }catch(error){failedOperations++;throw error instanceof D1Error?error:new D1Error('storage')}
    }).finally(()=>{active.delete(done)})
    const done=operation.then(()=>{},()=>{});active.add(done);return operation
  }
  return Object.freeze({dialect:'sqlite' as const,stats:()=>({pending:active.size,operations,statements,failedOperations,closing:closing!==undefined,closed}),
    execute:(input:SqlStatement)=>run([input]).then(values=>values[0]!),batch:run,
    close:()=>closing??=(async()=>{while(active.size)await Promise.all([...active]);closed=true})(),
  })
}
