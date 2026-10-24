export type FollowState='following'|'paused'|'stopped'|'complete'|'limit'|'error'
export interface CommandFollowOptions {
  readonly read:(signal:AbortSignal)=>Promise<boolean>
  readonly change:(state:FollowState,error?:unknown)=>void
  readonly intervalMs?:number
  readonly budgetMs?:number
  readonly maxChecks?:number
}

/** One page owns this bounded read loop. It never submits or retries a mutation. */
export function createCommandFollow(options:CommandFollowOptions){
  const interval=options.intervalMs??3000,budget=options.budgetMs??120000,maxChecks=options.maxChecks??30
  let enabled=false,paused=false,disposed=false,generation=0,deadline=0,checks=0
  let timer:ReturnType<typeof setTimeout>|undefined,expiry:ReturnType<typeof setTimeout>|undefined,inFlight:AbortController|undefined
  const clear=()=>{clearTimeout(timer);clearTimeout(expiry);timer=expiry=undefined}
  function end(state:FollowState,error?:unknown){enabled=false;++generation;clear();inFlight?.abort();if(!disposed)options.change(state,error)}
  function schedule(){
    if(!enabled||disposed||paused||inFlight)return
    if(Date.now()>=deadline||checks>=maxChecks){end('limit');return}
    clearTimeout(timer);timer=setTimeout(()=>{timer=undefined;void read()},Math.min(interval,deadline-Date.now()))
  }
  async function read(){
    if(!enabled||disposed||paused||inFlight)return
    if(Date.now()>=deadline||checks>=maxChecks){end('limit');return}
    const current=generation,controller=new AbortController();inFlight=controller;++checks
    try{
      const complete=await options.read(controller.signal)
      if(current!==generation||!enabled||controller.signal.aborted)return
      if(complete)end('complete')
    }catch(error){if(current===generation&&enabled&&!controller.signal.aborted)end('error',error)}
    finally{if(inFlight===controller)inFlight=undefined;schedule()}
  }
  return{
    get active(){return enabled},
    start(){
      if(disposed||enabled)return
      enabled=true;++generation;checks=0;deadline=Date.now()+budget
      expiry=setTimeout(()=>end('limit'),budget)
      options.change(paused?'paused':'following');schedule()
    },
    stop(){if(enabled)end('stopped')},
    setPaused(value:boolean){
      if(disposed||paused===value)return;paused=value
      if(!enabled)return
      ++generation;clearTimeout(timer);timer=undefined;inFlight?.abort()
      if(Date.now()>=deadline){end('limit');return}
      options.change(paused?'paused':'following');schedule()
    },
    dispose(){if(disposed)return;disposed=true;enabled=false;++generation;clear();inFlight?.abort()},
  }
}
