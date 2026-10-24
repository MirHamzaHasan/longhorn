import { afterEach,expect,it,vi } from 'vitest'
import { collectReceiptExport,ReceiptExportError } from './receipt-export.js'
import type { ReceiptExportSelection } from './receipt-export.js'

afterEach(()=>vi.useRealTimers())
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const command=(n:number)=>({id:id(n),createdAt:n,deliveryId:null,delivery:null})
const result={count:3,sum:30,min:6,max:15}
const receipt=(n:number)=>({receipts:[{messageId:id(n+100000),result}]})
const base=()=>({selection:{kind:'history' as const,scope:'mine',state:'all'},signal:new AbortController().signal,readReceipt:vi.fn(async()=>null as unknown)})
const lines=(value:{text:string})=>value.text.trim().split('\n').map(line=>JSON.parse(line))
it('exports copied scope/status/search and named metadata/results through serial protected reads',async()=>{
  const selection:ReceiptExportSelection={kind:'history',scope:'all',state:'succeeded',q:' ABCD '},calls:string[]=[]
  const read=vi.fn().mockResolvedValueOnce({commands:[{...command(1),numbers:[6,9,15],ownerId:'private'}],nextCursor:'next'}).mockResolvedValueOnce({commands:[command(2)],nextCursor:null})
  const readReceipt=vi.fn(async(commandId:string)=>{calls.push(commandId);(selection as {scope:string;q:string}).scope='mine';(selection as {q:string}).q='abce';return{receipts:[{...receipt(1).receipts[0]!,payload:'private',result:{...result,numbers:[6,9,15],token:'private'}}],password:'private'}})
  const output=await collectReceiptExport({...base(),selection,read,readReceipt,pageSize:1}),file=lines(output)
  expect(file[0]).toMatchObject({type:'longhorn-command-receipts',version:1,selection:{kind:'history',scope:'all',state:'succeeded',q:'abcd'}})
  expect(file[1]).toEqual({type:'command-receipt',command:command(1),receipt:{status:'received',receipts:receipt(1).receipts}});expect(calls).toEqual([id(1),id(2)]);expect(read.mock.calls[1]![0]).toMatchObject({after:'next',limit:1})
  expect(output.text).not.toMatch(/numbers|ownerId|payload|password|private|token/);expect(file.at(-1)).toMatchObject({count:2,complete:true,nextCursor:null})
})
it('preserves a protected not-found observation and receipts whose delivery metadata was pruned',async()=>{
  const output=await collectReceiptExport({...base(),read:async()=>({commands:[command(1),command(2)],nextCursor:null}),readReceipt:async value=>value===id(1)?null:receipt(2)})
  expect(lines(output).slice(1,-1).map(value=>value.receipt)).toEqual([{status:'not-found'},{status:'received',receipts:receipt(2).receipts}]);expect(output.count).toBe(2)
})
it('applies the actual 1000-command default and resumes from the accepted history cursor',async()=>{
  let n=0;const options=base(),read=vi.fn(async({limit}:{limit:number})=>({commands:Array.from({length:limit},()=>command(++n)),nextCursor:'next-'+n}))
  const first=await collectReceiptExport({...options,read});expect(first).toMatchObject({count:1000,pages:10,reason:'row-limit',nextCursor:'next-1000',complete:false});expect(read).toHaveBeenCalledTimes(10);expect(options.readReceipt).toHaveBeenCalledTimes(1000)
  const resumed=vi.fn(async(_input:{after?:string})=>({commands:[command(1001)],nextCursor:null})),second=await collectReceiptExport({...base(),after:first.nextCursor!,read:resumed})
  expect(resumed.mock.calls[0]![0]).toMatchObject({after:'next-1000'});expect(lines(second)[1].command.id).toBe(id(1001));expect(second.complete).toBe(true)
})
it('retains a whole-page continuation at smaller row/page/byte bounds',async()=>{
  for(const bound of[{maxRows:2},{maxPages:2},{maxBytes:6000}]){
    let n=0;const output=await collectReceiptExport({...base(),...bound,pageSize:1,readReceipt:async()=>receipt(1),read:async()=>({commands:[command(++n)],nextCursor:'next-'+n})})
    expect(output.complete).toBe(false);expect(output.nextCursor).toBe('next-'+output.count);expect(n).toBe(output.reason==='byte-limit'?output.count+1:output.count)
  }
})
it('exports an empty history without making a receipt request',async()=>{
  const options=base(),output=await collectReceiptExport({...options,read:async()=>({commands:[],nextCursor:null})})
  expect(lines(output)).toHaveLength(2);expect(output).toMatchObject({count:0,complete:true});expect(options.readReceipt).not.toHaveBeenCalled()
})
it('binds a single-command file to exactly one fresh command and forbids continuation',async()=>{
  const options={...base(),selection:{kind:'command' as const,commandId:id(1)},readReceipt:async()=>receipt(1)}
  expect(lines(await collectReceiptExport({...options,read:async()=>({commands:[command(1)],nextCursor:null})}))[0].selection).toEqual({kind:'command',commandId:id(1)})
  for(const page of[{commands:[],nextCursor:null},{commands:[command(2)],nextCursor:null},{commands:[command(1)],nextCursor:'next'}])await expect(collectReceiptExport({...options,read:async()=>page})).rejects.toBeInstanceOf(ReceiptExportError)
  await expect(collectReceiptExport({...options,after:'next',read:vi.fn()})).rejects.toThrow('Refresh and try again')
})
it('rejects invalid selections and request multiplication limits before reading',async()=>{
  for(const selection of[{kind:'history',scope:'all',state:'bad'},{kind:'history',scope:'other',state:'all'},{kind:'history',scope:'mine',state:'all',q:'abc%'},{kind:'command',commandId:'../private'}] as ReceiptExportSelection[])await expect(collectReceiptExport({...base(),selection,read:vi.fn()})).rejects.toThrow('Refresh and try again')
  for(const bounds of[{maxRows:1001},{maxPages:11},{pageSize:101},{maxRows:0},{budgetMs:-1}])await expect(collectReceiptExport({...base(),...bounds,read:vi.fn()})).rejects.toThrow('Refresh and try again')
})
it('validates every command and duplicate ID before starting receipt enrichment',async()=>{
  for(const commands of[[{...command(1),id:'bad'}],[command(1),{...command(2),createdAt:-1}],[command(1),command(1)]]){
    const options=base();await expect(collectReceiptExport({...options,read:async()=>({commands,nextCursor:null})})).rejects.toThrow('Refresh and try again');expect(options.readReceipt).not.toHaveBeenCalled()
  }
})
it('rejects malformed, excessive, duplicate or nonfinite receipt results',async()=>{
  for(const value of[{receipts:[]},{receipts:Array.from({length:101},(_,n)=>receipt(n).receipts[0])},{receipts:[...receipt(1).receipts,...receipt(1).receipts]},{receipts:[{messageId:'bad',result}]},...['count','sum','min','max'].map(key=>({receipts:[{messageId:id(10),result:{...result,[key]:Infinity}}]})),{receipts:[{messageId:id(10),result:{...result,count:0}}]}])await expect(collectReceiptExport({...base(),read:async()=>({commands:[command(1)],nextCursor:null}),readReceipt:async()=>value})).rejects.toThrow('Refresh and try again')
})
it('discards a whole segment on a later receipt authorization or service failure',async()=>{
  for(const message of['Forbidden','Receipt service unavailable']){
    const readReceipt=vi.fn().mockResolvedValueOnce(receipt(1)).mockRejectedValueOnce(new Error(message))
    await expect(collectReceiptExport({...base(),read:async()=>({commands:[command(1),command(2),command(3)],nextCursor:null}),readReceipt})).rejects.toThrow(message);expect(readReceipt).toHaveBeenCalledTimes(2)
  }
})
it('rejects repeated history cursors before rereading receipt effects',async()=>{
  const options=base();let n=0
  await expect(collectReceiptExport({...options,pageSize:1,read:async()=>({commands:[command(++n)],nextCursor:'repeated'})})).rejects.toThrow('Refresh and try again');expect(options.readReceipt).toHaveBeenCalledTimes(1)
})
it('cancels a receipt read and fences late completion before another command starts',async()=>{
  const controller=new AbortController();let release!:(value:unknown)=>void,signal!:AbortSignal
  const readReceipt=vi.fn(async(_id:string,current:AbortSignal)=>{signal=current;return new Promise(done=>{release=done})}),output=collectReceiptExport({...base(),signal:controller.signal,read:async()=>({commands:[command(1),command(2)],nextCursor:null}),readReceipt})
  await vi.waitFor(()=>expect(readReceipt).toHaveBeenCalledTimes(1));controller.abort();expect(signal.aborted).toBe(true);release(receipt(1));await expect(output).rejects.toMatchObject({name:'AbortError'});expect(readReceipt).toHaveBeenCalledTimes(1)
})
it('enforces the total deadline during enrichment even if a reader resolves late',async()=>{
  vi.useFakeTimers();let release!:(value:unknown)=>void,signal!:AbortSignal
  const output=collectReceiptExport({...base(),read:async()=>({commands:[command(1)],nextCursor:null}),readReceipt:async(_id,current)=>{signal=current;return new Promise(done=>{release=done})}}),rejection=expect(output).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(120000);expect(signal.aborted).toBe(true);release(receipt(1));await rejection
})
it('fails an oversized first receipt page without returning a file',async()=>{
  await expect(collectReceiptExport({...base(),maxBytes:5000,read:async()=>({commands:[command(1)],nextCursor:null}),readReceipt:async()=>({receipts:Array.from({length:100},(_,n)=>receipt(n).receipts[0])})})).rejects.toThrow('too large')
})
