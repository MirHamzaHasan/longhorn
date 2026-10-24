export type ExportReason='complete'|'row-limit'|'page-limit'|'byte-limit'
export interface BoundedExportOptions {
  readonly after?:string
  readonly signal:AbortSignal
  readonly read:(input:{limit:number;after?:string;signal:AbortSignal})=>Promise<unknown>
  readonly progress?:(count:number,pages:number)=>void
  readonly maxRows?:number
  readonly maxPages?:number
  readonly maxBytes?:number
  readonly pageSize?:number
  readonly budgetMs?:number
}
interface ExportProfile<T extends {id:string}> {
  readonly recordsKey:string
  readonly project:(value:unknown)=>T
  readonly header:(exportedAt:string)=>unknown
  readonly line:(value:T)=>unknown
  readonly invalid:()=>Error
  readonly tooLarge:()=>Error
  readonly timeout:()=>Error
}
/** App-local pagination/lifetime policy. Domain wrappers own the file schema and projection. */
export async function collectBoundedExport<T extends {id:string}>(options:BoundedExportOptions,profile:ExportProfile<T>){
  const invalid=profile.invalid,initial=options.after
  const cursor=(value:unknown):string|null=>{if(value===null)return null;if(typeof value!=='string'||!value||value.length>2048||!/^[A-Za-z0-9_-]+$/.test(value))throw invalid();return value}
  if(initial!==undefined)cursor(initial)
  const maxRows=options.maxRows??10000,maxPages=options.maxPages??100,maxBytes=options.maxBytes??8*1024*1024,pageSize=options.pageSize??100,budget=options.budgetMs??120000
  if(![maxRows,maxPages,maxBytes,pageSize,budget].every(n=>Number.isSafeInteger(n)&&n>0)||pageSize>100||maxBytes<=4096)throw invalid()
  const controller=new AbortController(),abort=()=>controller.abort();let expired=false
  options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort()
  const timer=setTimeout(()=>{expired=true;controller.abort()},budget),encoder=new TextEncoder(),exportedAt=new Date().toISOString()
  const active=()=>{if(expired)throw profile.timeout();if(controller.signal.aborted)throw new DOMException('Export canceled','AbortError')}
  let count=0,pages=0,after=initial,nextCursor:string|null=initial??null,reason:ExportReason='complete'
  try{
    const chunks=[JSON.stringify(profile.header(exportedAt))+'\n'],seen=new Set<string>(initial?[initial]:[]),ids=new Set<string>()
    let bytes=encoder.encode(chunks[0]).byteLength
    for(;;){
      active();const limit=Math.min(pageSize,maxRows-count)
      const raw=await options.read({limit,...(after===undefined?{}:{after}),signal:controller.signal});active()
      if(!raw||typeof raw!=='object'||Array.isArray(raw))throw invalid()
      const page=raw as Record<string,unknown>,next=cursor(page.nextCursor),records=page[profile.recordsKey]
      if(!Array.isArray(records)||records.length>limit||(next!==null&&records.length!==limit)||(next!==null&&seen.has(next)))throw invalid()
      const projected=records.map(profile.project),pageIds=new Set(projected.map(c=>c.id))
      if(pageIds.size!==projected.length||projected.some(c=>ids.has(c.id)))throw invalid()
      const chunk=projected.map(c=>JSON.stringify(profile.line(c))+'\n').join(''),size=encoder.encode(chunk).byteLength
      // Reject a whole page so continuation skips no records; reserve the bounded trailer/cursor.
      if(bytes+size+4096>maxBytes){if(count===0)throw profile.tooLarge();reason='byte-limit';break}
      chunks.push(chunk);bytes+=size;count+=projected.length;++pages;for(const id of pageIds)ids.add(id)
      nextCursor=next;options.progress?.(count,pages);active()
      if(next===null)break
      seen.add(next);after=next
      if(count>=maxRows){reason='row-limit';break}
      if(pages>=maxPages){reason='page-limit';break}
    }
    active();const complete=nextCursor===null
    chunks.push(JSON.stringify({type:'end',count,complete,reason,nextCursor})+'\n')
    const output=chunks.join('');if(encoder.encode(output).byteLength>maxBytes)throw invalid()
    return{text:output,count,pages,complete,reason,nextCursor,exportedAt}
  }catch(error){active();throw error}
  finally{clearTimeout(timer);options.signal.removeEventListener('abort',abort)}
}
