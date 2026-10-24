import { afterEach,expect,it,vi } from 'vitest'
import { createCommandFollow } from './command-follow.js'

afterEach(()=>{vi.useRealTimers()})
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return{promise,resolve}}
it('waits between settled reads, never overlaps and stops after a terminal result',async()=>{
  vi.useFakeTimers();const gate=deferred<boolean>(),change=vi.fn(),read=vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(true)
  const follow=createCommandFollow({read,change});follow.start();await vi.advanceTimersByTimeAsync(3000);expect(read).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(10000);expect(read).toHaveBeenCalledTimes(1)
  gate.resolve(false);await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(2999);expect(read).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1);expect(change).toHaveBeenLastCalledWith('complete',undefined);expect(follow.active).toBe(false)
  await vi.advanceTimersByTimeAsync(150000);expect(read).toHaveBeenCalledTimes(2)
})
it('aborts on stop and refuses to overlap a new run with an unsettled canceled read',async()=>{
  vi.useFakeTimers();const gate=deferred<boolean>(),signals:AbortSignal[]=[],change=vi.fn()
  const read=vi.fn((signal:AbortSignal)=>{signals.push(signal);return signals.length===1?gate.promise:Promise.resolve(false)})
  const follow=createCommandFollow({read,change});follow.start();await vi.advanceTimersByTimeAsync(3000);follow.stop();expect(signals[0]!.aborted).toBe(true)
  follow.start();await vi.advanceTimersByTimeAsync(10000);expect(read).toHaveBeenCalledTimes(1)
  gate.resolve(true);await vi.advanceTimersByTimeAsync(0);expect(follow.active).toBe(true);expect(change).not.toHaveBeenCalledWith('complete',undefined)
  await vi.advanceTimersByTimeAsync(3000);expect(read).toHaveBeenCalledTimes(2);follow.dispose()
})
it('pauses visibility/offline reads, aborts in-flight work and resumes without stale completion',async()=>{
  vi.useFakeTimers();const gate=deferred<boolean>(),change=vi.fn(),read=vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(false)
  const follow=createCommandFollow({read,change});follow.start();await vi.advanceTimersByTimeAsync(3000);const signal=read.mock.calls[0]![0]as AbortSignal
  follow.setPaused(true);expect(signal.aborted).toBe(true);gate.resolve(true);await vi.advanceTimersByTimeAsync(20000);expect(read).toHaveBeenCalledTimes(1);expect(change).toHaveBeenLastCalledWith('paused')
  follow.setPaused(false);await vi.advanceTimersByTimeAsync(3000);expect(read).toHaveBeenCalledTimes(2);follow.dispose()
})
it('expires its wall-clock budget even while paused and permits an explicit new bounded run',async()=>{
  vi.useFakeTimers();const read=vi.fn().mockResolvedValue(false),change=vi.fn(),follow=createCommandFollow({read,change})
  follow.setPaused(true);follow.start();await vi.advanceTimersByTimeAsync(120000);expect(read).not.toHaveBeenCalled();expect(change).toHaveBeenLastCalledWith('limit',undefined)
  follow.setPaused(false);follow.start();await vi.advanceTimersByTimeAsync(3000);expect(read).toHaveBeenCalledTimes(1);follow.dispose()
})
it('bounds total checks independently of time and aborts an active read at the deadline',async()=>{
  vi.useFakeTimers();const read=vi.fn().mockResolvedValue(false),change=vi.fn(),follow=createCommandFollow({read,change})
  follow.start();await vi.advanceTimersByTimeAsync(90000);expect(read).toHaveBeenCalledTimes(30);expect(change).toHaveBeenLastCalledWith('limit',undefined)
  const gate=deferred<boolean>(),blocked=vi.fn().mockReturnValue(gate.promise),second=createCommandFollow({read:blocked,change,budgetMs:10000})
  second.start();await vi.advanceTimersByTimeAsync(10000);expect((blocked.mock.calls[0]![0]as AbortSignal).aborted).toBe(true);gate.resolve(true);await vi.advanceTimersByTimeAsync(0);expect(second.active).toBe(false)
})
it('stops after a failed read without retrying it automatically',async()=>{
  vi.useFakeTimers();const error=new Error('service unavailable'),read=vi.fn().mockRejectedValue(error),change=vi.fn(),follow=createCommandFollow({read,change})
  follow.start();await vi.advanceTimersByTimeAsync(3000);expect(change).toHaveBeenLastCalledWith('error',error)
  await vi.advanceTimersByTimeAsync(120000);expect(read).toHaveBeenCalledTimes(1)
})
it('disposes timers and in-flight work without late notices or resurrection',async()=>{
  vi.useFakeTimers();const gate=deferred<boolean>(),read=vi.fn().mockReturnValue(gate.promise),change=vi.fn(),follow=createCommandFollow({read,change})
  follow.start();await vi.advanceTimersByTimeAsync(3000);follow.dispose();expect((read.mock.calls[0]![0]as AbortSignal).aborted).toBe(true)
  gate.resolve(true);follow.start();follow.setPaused(false);await vi.advanceTimersByTimeAsync(150000);expect(change).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledTimes(1)
})
