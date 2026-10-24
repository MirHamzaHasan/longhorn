import { collectBoundedExport } from './bounded-export.js'
import type { BoundedExportOptions } from './bounded-export.js'

export interface AuditExportOptions extends BoundedExportOptions {readonly selection:{readonly deliveryId?:string|null}}
export class AuditExportError extends Error {constructor(message:string){super(message);this.name='AuditExportError'}}
const queue='outbox.command.numbers.v1'
const invalid=()=>new AuditExportError('Recovery audit could not be exported. Refresh and try again.')
const record=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value as Record<string,unknown>}
const text=(value:unknown):string=>{if(typeof value!=='string'||!value||value.length>200)throw invalid();return value}
const uuid=(value:unknown):string=>{const result=text(value);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result))throw invalid();return result}
const integer=(value:unknown):number=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw invalid();return value}
const attempts=(value:unknown):number=>{const result=integer(value);if(result<1||result>100)throw invalid();return result}
function audit(value:unknown,deliveryId:string|null){
  const a=record(value),id=uuid(a.id),delivery=uuid(a.deliveryId),outcome=text(a.outcome),reason=text(a.reason)
  if(a.queue!==queue||(deliveryId!==null&&delivery!==deliveryId)||!['scheduled','conflict','budget-exhausted','missing'].includes(outcome)||!['manual-retry','provider-restored','configuration-fixed','investigating'].includes(reason))throw invalid()
  let result=null
  if(a.result!==null){
    const r=record(a.result),state=text(r.state),lastFailure=r.lastFailure
    if(!['pending','running','succeeded','failed'].includes(state)||(lastFailure!==null&&(typeof lastFailure!=='string'||!['handler','invalid-payload','lease-expired'].includes(lastFailure))))throw invalid()
    result={state,attempts:integer(r.attempts),maxAttempts:attempts(r.maxAttempts),lastFailure:lastFailure as string|null}
  }
  if((outcome==='missing')!==(result===null))throw invalid()
  // Audit snapshots survive delivery pruning. Never merge a current delivery or arbitrary response fields.
  return{id,queue,deliveryId:delivery,actor:text(a.actor),reason,createdAt:integer(a.createdAt),expectedMaxAttempts:attempts(a.expectedMaxAttempts),additionalAttempts:attempts(a.additionalAttempts),availableAt:integer(a.availableAt),outcome,result}
}
/** Operator-only API pages remain the authority; a file is emitted only after the whole segment succeeds. */
export async function collectAuditExport(options:AuditExportOptions){
  const deliveryId=options.selection.deliveryId??null
  if(deliveryId!==null)uuid(deliveryId)
  const selection={queue,deliveryId}
  return collectBoundedExport(options,{
    recordsKey:'records',project:value=>audit(value,deliveryId),line:record=>({type:'audit',record}),
    header:exportedAt=>({type:'longhorn-recovery-audit',version:1,exportedAt,selection}),invalid,
    tooLarge:()=>new AuditExportError('This audit page is too large to export. Try one delivery.'),
    timeout:()=>new AuditExportError('The export timed out. Try again.'),
  })
}
