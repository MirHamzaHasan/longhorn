import{Database as NativeDatabase}from'bun:sqlite'
import{AsyncLocalStorage}from'node:async_hooks'
import{mkdir,realpath}from'node:fs/promises'
import{dirname,basename,resolve}from'node:path'
import type{Database,QueryResult,SqlExecutor,SqlStatement,SqlValue}from'@longhornjs/database'
import{createTransactionScope}from'@longhornjs/database/transactions'
import{assertSqliteStatement}from'@longhornjs/database/sqlite-statement'

export type BunSqliteOptions={
  readonly filename:string;readonly busyTimeoutMs?:number;readonly maxPending?:number
  readonly maxSqlBytes?:number;readonly maxInputBytes?:number;readonly maxResultRows?:number;readonly maxResultBytes?:number
}
export type BunSqliteFailure='input'|'open'|'storage'|'protocol'|'result-limit'|'capacity'|'closed'|'transaction'
export class BunSqliteError extends Error{constructor(readonly code:BunSqliteFailure){super('Bun SQLite operation failed: '+code);this.name='BunSqliteError'}}
export interface BunSqliteDatabase extends Database{
  readonly dialect:'sqlite'
  stats():{readonly pending:number;readonly operations:number;readonly failedOperations:number;readonly closing:boolean;readonly closed:boolean}
}
type Gate={tail:Promise<void>;references:number}
type Held={gate:Gate;active:boolean}
const files=new Map<string,Gate>(),held=new AsyncLocalStorage<ReadonlySet<Held>>(),encoder=new TextEncoder()
function limit(value:number,maximum:number,minimum=1){if(!Number.isSafeInteger(value)||value<minimum||value>maximum)throw new BunSqliteError('input');return value}
/** Own a native bun:sqlite connection. SQL executes synchronously; the async facade owns queue/callback lifetime. */
export async function openSqlite(options:BunSqliteOptions):Promise<BunSqliteDatabase>{
  if(typeof options?.filename!=='string'||!options.filename.trim()||options.filename.includes('\0')||/[\uD800-\uDFFF]/u.test(options.filename))throw new BunSqliteError('input')
  const timeout=limit(options.busyTimeoutMs??5000,60000,0),maximum=limit(options.maxPending??64,10000)
  const sqlLimit=limit(options.maxSqlBytes??65536,1048576),inputLimit=limit(options.maxInputBytes??1048576,16777216)
  const rowLimit=limit(options.maxResultRows??1000,100000),resultLimit=limit(options.maxResultBytes??1048576,16777216)
  const memory=options.filename===':memory:'
  let filename=options.filename,key:string|undefined
  if(!memory){
    try{
      const path=resolve(filename);await mkdir(dirname(path),{recursive:true})
      try{filename=await realpath(path)}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error;filename=resolve(await realpath(dirname(path)),basename(path))}
      key=filename
    }catch{throw new BunSqliteError('open')}
  }
  const gate=(key?files.get(key):undefined)??{tail:Promise.resolve(),references:0}
  const reentrant=()=>[...(held.getStore()??[])].some(scope=>scope.active&&scope.gate===gate)
  if(reentrant())throw new BunSqliteError('transaction')
  let native:NativeDatabase
  try{native=new NativeDatabase(filename,{create:true,strict:true,safeIntegers:true})}catch{throw new BunSqliteError('open')}
  gate.references++;if(key)files.set(key,gate)
  let closing:Promise<void>|undefined,closed=false,operations=0,failedOperations=0
  const active=new Set<Promise<void>>()
  function snapshot(input:SqlStatement){
    const sql=typeof input==='string'?input:input?.sql
    if(typeof sql!=='string'||!sql.trim()||sql.length>sqlLimit||sql.includes('\0')||/[\uD800-\uDFFF]/u.test(sql))throw new BunSqliteError('input')
    let bytes=encoder.encode(sql).byteLength;if(bytes>sqlLimit)throw new BunSqliteError('input')
    try{assertSqliteStatement(sql)}catch{throw new BunSqliteError('input')}
    const source=typeof input==='string'?[]:input.args??[]
    if(!Array.isArray(source)||source.length>1000)throw new BunSqliteError('input')
    const charge=(count:number)=>{bytes+=count;if(bytes>inputLimit)throw new BunSqliteError('input')}
    charge(0)
    const args=Array.from(source,(value:SqlValue):SqlValue=>{
      if(value===null){charge(1);return null}
      if(typeof value==='boolean'){charge(8);return value?1n:0n}
      if(typeof value==='bigint'){if(value<-(2n**63n)||value>2n**63n-1n)throw new BunSqliteError('input');charge(8);return value}
      if(typeof value==='number'){if(!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value)))throw new BunSqliteError('input');charge(8);return value}
      if(typeof value==='string'){if(value.length>inputLimit||/[\uD800-\uDFFF]/u.test(value))throw new BunSqliteError('input');charge(encoder.encode(value).byteLength);return value}
      if(value instanceof Uint8Array){charge(value.byteLength);return new Uint8Array(value)}
      throw new BunSqliteError('input')
    })
    return {sql,args}
  }
  function run(input:ReturnType<typeof snapshot>):QueryResult{
    try{
      const meta=native.prepare<{total:bigint;changes:bigint;id:bigint},[]>('SELECT total_changes() AS total,changes() AS changes,last_insert_rowid() AS id')
      try{
        const before=meta.get()!,query=native.prepare<Record<string,unknown>,SqlValue[]>(input.sql)
        try{
          if(query.paramsCount!==input.args.length)throw new BunSqliteError('input')
          const rows=query.all(...input.args),after=meta.get()!
          if(typeof before.total!=='bigint'||typeof after.total!=='bigint'||typeof after.changes!=='bigint'||typeof after.id!=='bigint')throw new BunSqliteError('protocol')
          if(rows.length>rowLimit)throw new BunSqliteError('result-limit')
          let bytes=0
          const charge=(count:number)=>{bytes+=count;if(bytes>resultLimit)throw new BunSqliteError('result-limit')}
          const mapped=rows.map(row=>{
            const entries=Object.entries(row);if(entries.length>1000)throw new BunSqliteError('protocol')
            return Object.fromEntries(entries.map(([key,value]):[string,SqlValue]=>{
              charge(encoder.encode(key).byteLength)
              if(value===null){charge(1);return[key,null]}
              if(typeof value==='bigint'){charge(8);return[key,value]}
              if(typeof value==='number'&&Number.isFinite(value)){charge(8);return[key,value]}
              if(typeof value==='string'){charge(encoder.encode(value).byteLength);return[key,value]}
              if(value instanceof Uint8Array){charge(value.byteLength);return[key,new Uint8Array(value)]}
              throw new BunSqliteError('protocol')
            }))
          })
          // changes() alone is stale after reads; total_changes() includes trigger effects.
          const changes=after.total===before.total?0:Number(after.changes)
          if(!Number.isSafeInteger(changes)||changes<0)throw new BunSqliteError('protocol')
          return {rows:mapped,rowsAffected:changes,lastInsertId:after.id===0n?undefined:after.id}
        }finally{query.finalize()}
      }finally{meta.finalize()}
    }catch(error){throw error instanceof BunSqliteError?error:new BunSqliteError('storage')}
  }
  function queue<T>(work:()=>T|Promise<T>):Promise<T>{
    if(reentrant())return Promise.reject(new BunSqliteError('transaction'))
    if(closing)return Promise.reject(new BunSqliteError('closed'))
    if(active.size>=maximum)return Promise.reject(new BunSqliteError('capacity'))
    operations++
    // Keep this handle's accepted work separate from the shared file's admission tail.
    const operation=gate.tail.then(work).catch(error=>{failedOperations++;throw error}).finally(()=>active.delete(done))
    const done=operation.then(()=>{},()=>{});active.add(done);gate.tail=done;return operation
  }
  const database:BunSqliteDatabase=Object.freeze({dialect:'sqlite' as const,
    stats:()=>({pending:active.size,operations,failedOperations,closing:closing!==undefined,closed}),
    execute(input:SqlStatement){let copy:ReturnType<typeof snapshot>;try{copy=snapshot(input)}catch(error){return Promise.reject(error)}return queue(()=>run(copy))},
    transaction<T>(work:(executor:SqlExecutor)=>T|Promise<T>):Promise<T>{
      if(typeof work!=='function')return Promise.reject(new BunSqliteError('input'))
      return queue(async()=>{
        // Bun's synchronous transaction wrapper cannot own the callback across await.
        try{native.run('BEGIN IMMEDIATE')}catch{throw new BunSqliteError('storage')}
        const ownership:Held={gate,active:true}
        const delegate:SqlExecutor={dialect:'sqlite',execute(input){
          // OR ROLLBACK may have ended the native transaction even if its error was caught.
          if(!ownership.active||!native.inTransaction)return Promise.reject(new BunSqliteError('transaction'))
          try{return Promise.resolve(run(snapshot(input)))}catch(error){if(!native.inTransaction)ownership.active=false;return Promise.reject(error)}
        }}
        const publication=createTransactionScope(database,delegate)
        try{
          const scopes=new Set(held.getStore());scopes.add(ownership)
          const result=await held.run(scopes,()=>work(publication.executor))
          await publication.complete()
          if(!ownership.active||!native.inTransaction)throw new BunSqliteError('transaction')
          ownership.active=false
          try{native.run('COMMIT')}catch{throw new BunSqliteError('storage')}
          return result
        }catch(error){
          await publication.abort();ownership.active=false
          if(native.inTransaction)try{native.run('ROLLBACK')}catch{throw new AggregateError([error,new BunSqliteError('storage')],'Bun SQLite transaction and rollback failed')}
          throw error
        }finally{ownership.active=false}
      })
    },
    close(){
      if(reentrant())return Promise.reject(new BunSqliteError('transaction'))
      return closing??=(async()=>{while(active.size)await Promise.all([...active]);try{native.close(true)}catch{throw new BunSqliteError('storage')}finally{closed=true;gate.references--;if(key&&gate.references===0)files.delete(key)}})()
    },
  })
  try{
    await queue(()=>{try{native.run(`PRAGMA busy_timeout=${timeout}`);native.run('PRAGMA foreign_keys=ON');native.run('PRAGMA journal_mode=WAL');native.run('PRAGMA synchronous=FULL')}catch{throw new BunSqliteError('open')}})
    return database
  }catch(error){
    try{await database.close()}catch(closeError){throw new AggregateError([error,closeError],'Bun SQLite initialization and cleanup failed')}
    throw error
  }
}
