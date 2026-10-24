import { afterEach,expect,it,vi } from 'vitest'
import { collectHistoryExport } from './history-export.js'

afterEach(()=>vi.useRealTimers())
const command=(id:string)=>({id,createdAt:null,deliveryId:null,delivery:null})
const base=()=>({selection:{scope:'mine',state:'all'},signal:new AbortController().signal})
const lines=(value:{text:string})=>value.text.trim().split('\n').map(line=>JSON.parse(line))
it('exports multiple pages through a copied selection and strips fields outside the metadata projection',async()=>{
  const options=base(),read=vi.fn().mockImplementationOnce(async()=>{options.selection.scope='all';return{commands:[{...command('one'),numbers:[123],payload:'secret',lease_token:'secret'}],nextCursor:'next'}}).mockResolvedValueOnce({commands:[command('two')],nextCursor:null})
  const result=await collectHistoryExport({...options,pageSize:1,read}),records=lines(result)
  expect(records[0]).toMatchObject({type:'longhorn-command-history',version:1,selection:{scope:'mine',state:'all'}})
  expect(records.slice(1,-1).map(r=>r.command.id)).toEqual(['one','two']);expect(records.at(-1)).toMatchObject({type:'end',count:2,complete:true,nextCursor:null,reason:'complete'})
  expect(read.mock.calls[1]![0]).toMatchObject({after:'next',limit:1});expect(result.text).not.toMatch(/payload|numbers|lease_token|secret/)
})
it('stops at the real default 10000-row bound and resumes from that exact continuation',async()=>{
  let total=0
  const read=vi.fn(async({limit}:{limit:number})=>{const start=total;total+=limit;return{commands:Array.from({length:limit},(_,i)=>command('id-'+(start+i))),nextCursor:'cursor-'+total}})
  const first=await collectHistoryExport({...base(),read});expect(first.count).toBe(10000);expect(read).toHaveBeenCalledTimes(100);expect(first).toMatchObject({complete:false,reason:'row-limit',nextCursor:'cursor-10000'})
  const resumed=vi.fn().mockResolvedValue({commands:[command('older')],nextCursor:null}),second=await collectHistoryExport({...base(),after:first.nextCursor!,read:resumed})
  expect(second.count).toBe(1);expect(second.complete).toBe(true);expect(resumed.mock.calls[0]![0]).toMatchObject({after:'cursor-10000'})
})
it('bounds pages and UTF-8 bytes without skipping a rejected page',async()=>{
  const page=await collectHistoryExport({...base(),pageSize:1,maxPages:1,read:async()=>({commands:[command('one')],nextCursor:'page-1'})});expect(page).toMatchObject({count:1,reason:'page-limit',nextCursor:'page-1'})
  let index=0
  const result=await collectHistoryExport({...base(),pageSize:1,maxBytes:6000,read:async()=>({commands:[command('🐮'.repeat(50)+(++index))],nextCursor:'page-'+index})})
  expect(result.count).toBeGreaterThan(0);expect(index).toBe(result.count+1);expect(result).toMatchObject({reason:'byte-limit',nextCursor:'page-'+result.count});expect(new TextEncoder().encode(result.text).byteLength).toBeLessThanOrEqual(6000)
  await expect(collectHistoryExport({...base(),maxBytes:4100,read:async()=>({commands:[command('one')],nextCursor:null})})).rejects.toThrow('too large')
})
it('exports an empty admitted selection as an explicit complete file',async()=>{
  const result=await collectHistoryExport({...base(),read:async()=>({commands:[],nextCursor:null})});expect(lines(result)).toHaveLength(2);expect(result).toMatchObject({count:0,complete:true,nextCursor:null})
})
it('rejects malformed metadata, page sizes and cursors rather than serializing arbitrary values',async()=>{
  for(const response of[
    {commands:[{...command('one'),createdAt:-1}],nextCursor:null},
    {commands:[{...command('one'),deliveryId:'delivery',delivery:{id:'another',state:'pending',attempts:0,maxAttempts:3,availableAt:1,updatedAt:1,lastFailure:null}}],nextCursor:null},
    {commands:[{...command('one'),deliveryId:'delivery',delivery:{id:'delivery',state:'pending',attempts:0,maxAttempts:3,availableAt:1,updatedAt:1,lastFailure:{message:'handler'}}}],nextCursor:null},
    {commands:[],nextCursor:'next'},
    {commands:[command('one')],nextCursor:'!'},
    {commands:[command('one'),command('two')],nextCursor:null},
  ])await expect(collectHistoryExport({...base(),pageSize:1,read:async()=>response})).rejects.toThrow('Refresh and try again')
})
it('rejects repeated cursors and duplicate commands across pages',async()=>{
  for(const repeatCursor of[true,false]){
    let page=0
    await expect(collectHistoryExport({...base(),pageSize:1,read:async()=>({commands:[command(repeatCursor?'id-'+(++page):'one')],nextCursor:repeatCursor?'repeated':'next-'+(++page)})})).rejects.toThrow('Refresh and try again')
  }
})
it('returns no file after cancellation even if an admitted reader completes late',async()=>{
  const controller=new AbortController();let release!:(value:unknown)=>void,captured!:AbortSignal
  const result=collectHistoryExport({...base(),signal:controller.signal,read:async input=>{captured=input.signal;return new Promise(done=>{release=done})}})
  controller.abort();expect(captured.aborted).toBe(true);release({commands:[command('one')],nextCursor:null});await expect(result).rejects.toMatchObject({name:'AbortError'})
  const read=vi.fn();await expect(collectHistoryExport({...base(),signal:controller.signal,read})).rejects.toMatchObject({name:'AbortError'});expect(read).not.toHaveBeenCalled()
})
it('aborts the run deadline and does not convert a timed-out late response into a download',async()=>{
  vi.useFakeTimers();let release!:(value:unknown)=>void,signal!:AbortSignal
  const result=collectHistoryExport({...base(),read:async input=>{signal=input.signal;return new Promise(done=>{release=done})}})
  const rejection=expect(result).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(120000);expect(signal.aborted).toBe(true);release({commands:[command('late')],nextCursor:null});await rejection
})
it('fails the entire segment after a later authorization or network error without replaying a page',async()=>{
  const read=vi.fn().mockResolvedValueOnce({commands:[command('one')],nextCursor:'next'}).mockRejectedValueOnce(new Error('Denied'))
  await expect(collectHistoryExport({...base(),pageSize:1,read})).rejects.toThrow('Denied');expect(read).toHaveBeenCalledTimes(2)
})
