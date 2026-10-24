export type HistoryExportSelection={readonly scope:string;readonly state:string}
type ExportReason='complete'|'row-limit'|'page-limit'|'byte-limit'
export interface HistoryExportOptions {
  readonly selection:HistoryExportSelection
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
export class HistoryExportError extends Error {constructor(message:string){super(message);this.name='HistoryExportError'}}
const invalid=()=>new HistoryExportError('History could not be exported. Refresh and try again.')
const record=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value as Record<string,unknown>}
const text=(value:unknown):string=>{if(typeof value!=='string'||!value||value.length>200)throw invalid();return value}
const integer=(value:unknown):number=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw invalid();return value}
const cursor=(value:unknown):string|null=>{if(value===null)return null;if(typeof value!=='string'||!value||value.length>2048||!/^[A-Za-z0-9_-]+$/.test(value))throw invalid();return value}
function command(value:unknown){
  const c=record(value),deliveryId=c.deliveryId===null?null:text(c.deliveryId)
  let delivery=null
  if(c.delivery!==null){
    const d=record(c.delivery),id=text(d.id),state=text(d.state),attempts=integer(d.attempts),maxAttempts=integer(d.maxAttempts),lastFailure=d.lastFailure
    if(id!==deliveryId||!['pending','running','succeeded','failed'].includes(state)||maxAttempts<1||maxAttempts>100||(lastFailure!==null&&(typeof lastFailure!=='string'||!['handler','invalid-payload','lease-expired'].includes(lastFailure))))throw invalid()
    delivery={id,state,attempts,maxAttempts,availableAt:integer(d.availableAt),updatedAt:integer(d.updatedAt),lastFailure:lastFailure as string|null}
  }
  // Copy only the established metadata projection, even if a response contains extra fields.
  return{id:text(c.id),createdAt:c.createdAt===null?null:integer(c.createdAt),deliveryId,delivery}
}
/** Collect a bounded segment; no partial file escapes after a failed or canceled read. */
export async function collectHistoryExport(options:HistoryExportOptions){
  const selection={scope:options.selection.scope,state:options.selection.state},initial=options.after
  if(!['mine','all'].includes(selection.scope)||!['all','pending','running','succeeded','failed','unavailable'].includes(selection.state))throw invalid()
  if(initial!==undefined)cursor(initial)
  const maxRows=options.maxRows??10000,maxPages=options.maxPages??100,maxBytes=options.maxBytes??8*1024*1024,pageSize=options.pageSize??100,budget=options.budgetMs??120000
  if(![maxRows,maxPages,maxBytes,pageSize,budget].every(n=>Number.isSafeInteger(n)&&n>0)||pageSize>100||maxBytes<=4096)throw invalid()
  const controller=new AbortController(),abort=()=>controller.abort();let expired=false
  options.signal.addEventListener('abort',abort,{once:true});if(options.signal.aborted)abort()
  const timer=setTimeout(()=>{expired=true;controller.abort()},budget),encoder=new TextEncoder(),exportedAt=new Date().toISOString()
  const active=()=>{if(expired)throw new HistoryExportError('The export timed out. Try again.');if(controller.signal.aborted)throw new DOMException('Export canceled','AbortError')}
  const chunks=[JSON.stringify({type:'longhorn-command-history',version:1,exportedAt,selection})+'\n'],seen=new Set<string>(initial?[initial]:[]),ids=new Set<string>()
  let bytes=encoder.encode(chunks[0]).byteLength,count=0,pages=0,after=initial,nextCursor:string|null=initial??null,reason:ExportReason='complete'
  try{
    for(;;){
      active();const limit=Math.min(pageSize,maxRows-count)
      const raw=await options.read({limit,...(after===undefined?{}:{after}),signal:controller.signal});active()
      const page=record(raw),next=cursor(page.nextCursor)
      if(!Array.isArray(page.commands)||page.commands.length>limit||(next!==null&&page.commands.length!==limit)||(next!==null&&seen.has(next)))throw invalid()
      const commands=page.commands.map(command),pageIds=new Set(commands.map(c=>c.id))
      if(pageIds.size!==commands.length||commands.some(c=>ids.has(c.id)))throw invalid()
      const chunk=commands.map(c=>JSON.stringify({type:'command',command:c})+'\n').join(''),size=encoder.encode(chunk).byteLength
      // Reserve enough for the bounded cursor and final summary; reject the whole page so continuation skips no rows.
      if(bytes+size+4096>maxBytes){if(count===0)throw new HistoryExportError('This history page is too large to export. Try a narrower delivery filter.');reason='byte-limit';break}
      chunks.push(chunk);bytes+=size;count+=commands.length;++pages;for(const id of pageIds)ids.add(id)
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
