import { afterEach,expect,it,vi } from 'vitest'
import { AuditExportError,collectAuditExport } from './audit-export.js'

afterEach(()=>vi.useRealTimers())
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const audit=(n:number)=>({id:id(n),queue:'outbox.command.numbers.v1',deliveryId:id(100000),actor:id(200000),reason:'provider-restored',createdAt:n,expectedMaxAttempts:3,additionalAttempts:2,availableAt:n,outcome:'scheduled',result:{state:'pending',attempts:3,maxAttempts:5,lastFailure:'handler'}})
const base=()=>({selection:{},signal:new AbortController().signal})
const lines=(result:{text:string})=>result.text.trim().split('\n').map(line=>JSON.parse(line))
it('exports all four recorded outcomes through the closed audit projection, including a missing/pruned delivery',async()=>{
  const rows=['scheduled','conflict','budget-exhausted','missing'].map((outcome,i)=>({...audit(i),outcome,result:outcome==='missing'?null:audit(i).result,numbers:[7],payload:'private',lease_token:'private',password:'private'}))
  const result=await collectAuditExport({...base(),read:async()=>({records:rows,nextCursor:null})}),file=lines(result)
  expect(file[0]).toMatchObject({type:'longhorn-recovery-audit',version:1,selection:{queue:'outbox.command.numbers.v1',deliveryId:null}})
  expect(file.slice(1,-1)).toEqual(rows.map(({numbers,payload,lease_token,password,...record})=>({type:'audit',record})))
  expect(file.at(-1)).toMatchObject({count:4,complete:true,nextCursor:null,reason:'complete'});expect(result.text).not.toMatch(/private|numbers"|payload|lease_token|password/)
})
it('copies the selected delivery before awaiting and refuses another delivery or queue',async()=>{
  const selection={deliveryId:id(100000)},read=vi.fn(async()=>{selection.deliveryId=id(100001);return{records:[audit(1)],nextCursor:null}})
  const result=await collectAuditExport({...base(),selection,read});expect(lines(result)[0].selection.deliveryId).toBe(id(100000))
  for(const row of[{...audit(1),deliveryId:id(3)},{...audit(1),queue:'another-queue'}])await expect(collectAuditExport({...base(),selection:{deliveryId:id(100000)},read:async()=>({records:[row],nextCursor:null})})).rejects.toBeInstanceOf(AuditExportError)
  await expect(collectAuditExport({...base(),selection:{deliveryId:'../invalid'},read})).rejects.toThrow('Refresh and try again')
})
it('produces an explicit empty file and retains the exact last accepted cursor at every bound',async()=>{
  const empty=await collectAuditExport({...base(),read:async()=>({records:[],nextCursor:null})});expect(lines(empty)).toHaveLength(2);expect(empty).toMatchObject({count:0,complete:true})
  for(const bound of[{maxRows:2},{maxPages:2},{maxBytes:5800}]){
    let n=0
    const result=await collectAuditExport({...base(),...bound,pageSize:1,read:async()=>({records:[audit(++n)],nextCursor:'page-'+n})})
    expect(result.complete).toBe(false);expect(result.nextCursor).toBe('page-'+result.count)
    const read=vi.fn(async(_input:{after?:string})=>({records:[audit(result.count+1)],nextCursor:null})),resumed=await collectAuditExport({...base(),after:result.nextCursor!,read})
    expect(read.mock.calls[0]![0]).toMatchObject({after:result.nextCursor});expect(lines(resumed)[1].record.id).toBe(id(result.count+1))
  }
})
it('rejects invalid audit states, retry bounds, identifiers and unsafe timestamps',async()=>{
  const valid=audit(1)
  for(const row of[
    {...valid,id:'invalid'}, {...valid,actor:''}, {...valid,createdAt:Number.MAX_SAFE_INTEGER+1}, {...valid,availableAt:-1},
    {...valid,reason:'raw exception'}, {...valid,outcome:'unknown'}, {...valid,expectedMaxAttempts:0}, {...valid,additionalAttempts:101},
    {...valid,result:null}, {...valid,outcome:'missing'}, {...valid,result:{...valid.result,lastFailure:'private exception'}},
    {...valid,result:{...valid.result,state:'unknown'}}, {...valid,result:{...valid.result,maxAttempts:101}},
  ])await expect(collectAuditExport({...base(),read:async()=>({records:[row],nextCursor:null})})).rejects.toThrow('Recovery audit could not be exported')
})
it('rejects invalid pages, repeated cursors and duplicate IDs without a partial file',async()=>{
  for(const nextPage of[{records:[],nextCursor:'next'},{records:[audit(2)],nextCursor:'first'},{records:[audit(1)],nextCursor:null},{commands:[audit(2)],nextCursor:null}]){
    const read=vi.fn().mockResolvedValueOnce({records:[audit(1)],nextCursor:'first'}).mockResolvedValueOnce(nextPage)
    await expect(collectAuditExport({...base(),pageSize:1,read})).rejects.toThrow('Refresh and try again')
  }
})
it('discards all collected rows if the next page loses authorization',async()=>{
  const read=vi.fn().mockResolvedValueOnce({records:[audit(1)],nextCursor:'next'}).mockRejectedValueOnce(new Error('Forbidden'))
  await expect(collectAuditExport({...base(),pageSize:1,read})).rejects.toThrow('Forbidden');expect(read).toHaveBeenCalledTimes(2)
})
it('aborts on cancellation and deadline even when an admitted response settles late',async()=>{
  vi.useFakeTimers()
  for(const timeout of[false,true]){
    const controller=new AbortController();let release!:(value:unknown)=>void,signal!:AbortSignal
    const result=collectAuditExport({...base(),signal:controller.signal,read:async input=>{signal=input.signal;return new Promise(done=>{release=done})}})
    const rejected=timeout?expect(result).rejects.toThrow('timed out'):expect(result).rejects.toMatchObject({name:'AbortError'})
    if(timeout)await vi.advanceTimersByTimeAsync(120000);else controller.abort()
    expect(signal.aborted).toBe(true);release({records:[audit(1)],nextCursor:null});await rejected
  }
})
