import { collectBoundedExport } from './bounded-export.js'
import type { BoundedExportOptions } from './bounded-export.js'
import { projectCommandMetadata } from './history-metadata.js'
import { normalizeHistorySearch } from './history-search.js'

export type ReceiptExportSelection={readonly kind:'history';readonly scope:string;readonly state:string;readonly q?:string}|{readonly kind:'command';readonly commandId:string}
export interface ReceiptExportOptions extends BoundedExportOptions {
  readonly selection:ReceiptExportSelection
  /** null means an actual protected 404 observation; failures must reject. */
  readonly readReceipt:(commandId:string,signal:AbortSignal)=>Promise<unknown|null>
}
export class ReceiptExportError extends Error {constructor(message:string){super(message);this.name='ReceiptExportError'}}
const invalid=()=>new ReceiptExportError('Receipts could not be exported. Refresh and try again.')
const uuid=(value:string)=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw invalid();return value}
const record=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value as Record<string,unknown>}
function receipt(value:unknown){
  if(value===null)return{status:'not-found' as const}
  const page=record(value)
  if(!Array.isArray(page.receipts)||page.receipts.length<1||page.receipts.length>100)throw invalid()
  const ids=new Set<string>(),receipts=page.receipts.map(value=>{
    const entry=record(value),result=record(entry.result)
    if(typeof entry.messageId!=='string')throw invalid()
    const messageId=uuid(entry.messageId)
    if(ids.has(messageId)||typeof result.count!=='number'||!Number.isInteger(result.count)||result.count<1||result.count>100)throw invalid()
    ids.add(messageId)
    const finite=(value:unknown)=>{if(typeof value!=='number'||!Number.isFinite(value))throw invalid();return value}
    return{messageId,result:{count:result.count,sum:finite(result.sum),min:finite(result.min),max:finite(result.max)}}
  })
  return{status:'received' as const,receipts}
}
/** One row per command, including explicit 404 observations; protected reads remain serial and cancellable. */
export async function collectReceiptExport(options:ReceiptExportOptions){
  let selection:{kind:'command';commandId:string}|{kind:'history';scope:string;state:string;q:string|null}
  if(options.selection.kind==='command'){
    selection={kind:'command',commandId:uuid(options.selection.commandId)}
    if(options.after!==undefined)throw invalid()
  }else if(options.selection.kind==='history'){
    let q:string|undefined;try{q=normalizeHistorySearch(options.selection.q)}catch{throw invalid()}
    selection={kind:'history',scope:options.selection.scope,state:options.selection.state,q:q??null}
    if(!['mine','all'].includes(selection.scope)||!['all','pending','running','succeeded','failed','unavailable'].includes(selection.state))throw invalid()
  }else throw invalid()
  // Receipt reads multiply the history requests, so this protocol has smaller segment limits.
  if((options.maxRows??1000)>1000||(options.maxPages??10)>10)throw invalid()
  const single=selection.kind==='command',commandId=selection.kind==='command'?selection.commandId:undefined
  return collectBoundedExport({...options,maxRows:single?1:options.maxRows??1000,maxPages:single?1:options.maxPages??10,pageSize:single?1:options.pageSize??100,
    read:async input=>{const page=await options.read(input);if(single){const p=record(page);if(!Array.isArray(p.commands)||p.commands.length!==1||p.nextCursor!==null)throw invalid()}return page},
  },{
    recordsKey:'commands',project:value=>{const command=projectCommandMetadata(value,invalid);uuid(command.id);if(commandId!==undefined&&command.id!==commandId)throw invalid();return command},
    header:exportedAt=>({type:'longhorn-command-receipts',version:1,exportedAt,selection}),
    line:async(command,signal)=>({type:'command-receipt',command,receipt:receipt(await options.readReceipt(command.id,signal))}),invalid,
    tooLarge:()=>new ReceiptExportError('This receipt page is too large to export. Try a narrower history filter.'),
    timeout:()=>new ReceiptExportError(single?'The export timed out. Try again.':'The export timed out. Try a narrower history filter.'),
  })
}
