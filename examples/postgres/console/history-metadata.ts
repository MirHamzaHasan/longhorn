export function projectCommandMetadata(value:unknown,invalid:()=>Error){
  const record=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();return value as Record<string,unknown>}
  const text=(value:unknown):string=>{if(typeof value!=='string'||!value||value.length>200)throw invalid();return value}
  const integer=(value:unknown):number=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw invalid();return value}
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
