import { afterEach,expect,it,vi } from 'vitest'
import { IdempotencyCleanup } from './cleanup.js'
afterEach(()=>vi.useRealTimers())
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve()}
it('does no work before start, copies bounds, and waits after full batches',async()=>{
  vi.useFakeTimers();const options={limit:2,intervalMs:50},prune=vi.fn(async()=>2),cleanup=new IdempotencyCleanup({prune},options);options.limit=100;options.intervalMs=1
  expect(cleanup.snapshot()).toEqual({state:'idle',active:false,runs:0,removed:0,errors:0,observerErrors:0});expect(prune).not.toHaveBeenCalled();cleanup.start();await flush();expect(prune).toHaveBeenCalledExactlyOnceWith(2)
  await vi.advanceTimersByTimeAsync(49);expect(prune).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);expect(prune).toHaveBeenCalledTimes(2);expect(cleanup.snapshot().removed).toBe(4);await cleanup.close();expect(vi.getTimerCount()).toBe(0)
})
it('uses the real default batch/interval without an automatic backlog loop',async()=>{
  vi.useFakeTimers();const prune=vi.fn(async()=>100),cleanup=new IdempotencyCleanup({prune});cleanup.start();await flush();expect(prune).toHaveBeenCalledExactlyOnceWith(100);await vi.advanceTimersByTimeAsync(59999);expect(prune).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);expect(prune).toHaveBeenCalledTimes(2);await cleanup.close()
})
it('never overlaps an admitted prune or catches up after a slow call',async()=>{
  vi.useFakeTimers();let release!:(n:number)=>void;const prune=vi.fn(()=>new Promise<number>(done=>{release=done})),cleanup=new IdempotencyCleanup({prune},{intervalMs:10});cleanup.start();await flush();await vi.advanceTimersByTimeAsync(1000);expect(prune).toHaveBeenCalledTimes(1);expect(cleanup.snapshot().active).toBe(true);release(0);await flush();await vi.advanceTimersByTimeAsync(9);expect(prune).toHaveBeenCalledTimes(1);const closing=cleanup.close();await closing;expect(vi.getTimerCount()).toBe(0)
})
it('drains a held call and prevents admissions after close',async()=>{
  vi.useFakeTimers();let release!:(n:number)=>void;const prune=vi.fn(()=>new Promise<number>(done=>{release=done})),cleanup=new IdempotencyCleanup({prune},{intervalMs:5});cleanup.start();await flush();let closed=false;const close=cleanup.close().then(()=>{closed=true});await flush();expect(closed).toBe(false);expect(cleanup.snapshot().state).toBe('closing');release(3);await close;await vi.advanceTimersByTimeAsync(100);expect(prune).toHaveBeenCalledTimes(1);expect(cleanup.snapshot()).toMatchObject({state:'closed',active:false,removed:3});expect(()=>cleanup.start()).toThrow('only start once')
})
it('closes before start or immediately after start without creating timers',async()=>{
  vi.useFakeTimers();for(const start of[false,true]){const prune=vi.fn(async()=>0),cleanup=new IdempotencyCleanup({prune});if(start)cleanup.start();const closed=cleanup.close();expect(cleanup.close()).toBe(closed);await closed;expect(prune).not.toHaveBeenCalled();expect(cleanup.snapshot().state).toBe('closed')}expect(vi.getTimerCount()).toBe(0)
})
it('owns a synchronous close requested by a custom pruner until that pruner settles',async()=>{
  let release!:(n:number)=>void,close!:Promise<void>,closed=false
  const cleanup=new IdempotencyCleanup({prune(){close=cleanup.close();void close.then(()=>{closed=true});return new Promise<number>(done=>{release=done})}});cleanup.start();await flush();expect(closed).toBe(false);release(0);await close;expect(closed).toBe(true);expect(cleanup.snapshot().state).toBe('closed')
})
it('recovers after provider failure with the configured delay and counts only real removals',async()=>{
  vi.useFakeTimers();const problem=new Error('private provider details'),onError=vi.fn(),prune=vi.fn().mockRejectedValueOnce(problem).mockResolvedValue(2),cleanup=new IdempotencyCleanup({prune},{limit:2,intervalMs:10,onError});cleanup.start();await flush();expect(onError).toHaveBeenCalledWith(problem);await vi.advanceTimersByTimeAsync(9);expect(prune).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);expect(cleanup.snapshot()).toMatchObject({runs:2,removed:2,errors:1,observerErrors:0});expect(JSON.stringify(cleanup.snapshot())).not.toContain('private');await cleanup.close()
})
it('awaits async error observation during shutdown and reports observer failure',async()=>{
  let release!:()=>void;const observed=new Error('observer failed'),cleanup=new IdempotencyCleanup({prune:async()=>{throw new Error('provider failed')}},{onError:async()=>{await new Promise<void>(done=>{release=done});throw observed}});cleanup.start();await flush();expect(cleanup.snapshot().active).toBe(true);const closed=cleanup.close(),rejected=expect(closed).rejects.toBe(observed);await flush();expect(cleanup.snapshot().state).toBe('closing');release();await rejected;expect(cleanup.snapshot()).toMatchObject({state:'closed',active:false,errors:1,observerErrors:1});expect(cleanup.close()).toBe(closed)
})
it('rejects invalid removal counts as failed runs',async()=>{
  for(const count of[-1,1.5,101,NaN,Infinity]){const observed=vi.fn(),cleanup=new IdempotencyCleanup({prune:async()=>count},{onError:observed});cleanup.start();await flush();await cleanup.close();expect(observed).toHaveBeenCalledTimes(1);expect(cleanup.snapshot()).toMatchObject({removed:0,errors:1})}
})
it('validates bounds before admission and returns detached snapshots',async()=>{
  for(const options of[{limit:0},{limit:10001},{intervalMs:0},{intervalMs:2147483648},{limit:NaN}])expect(()=>new IdempotencyCleanup({prune:async()=>0},options)).toThrow('Invalid cleanup')
  const cleanup=new IdempotencyCleanup({prune:async()=>0}),snapshot=cleanup.snapshot();(snapshot as {runs:number}).runs=99;expect(cleanup.snapshot().runs).toBe(0);await cleanup.close()
})
