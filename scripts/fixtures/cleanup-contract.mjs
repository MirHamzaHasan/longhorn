import { IdempotencyCleanup } from '../../packages/idempotency/dist/cleanup.js'
const assert=(value,message)=>{if(!value)throw new Error(message)}
const sleep=ms=>new Promise(done=>setTimeout(done,ms))
const waitFor=async test=>{const end=Date.now()+5000;while(Date.now()<end){if(test())return;await sleep(1)}throw new Error('Cleanup contract did not settle')}
/** Pure Web coordination probe; SQL effects have separate native proofs. */
export async function cleanupContract(){
  let calls=0,active=0,maximum=0,release,observed=0
  const worker=new IdempotencyCleanup({async prune(limit){assert(limit===2,'Wrong limit');calls++;active++;maximum=Math.max(maximum,active);try{if(calls===1){await new Promise(done=>{release=done});return 2}if(calls===2)throw new Error('private provider details');return 1}finally{active--}}},{limit:2,intervalMs:5,onError:async()=>{await sleep(2);observed++}})
  worker.start();await waitFor(()=>!!release);await sleep(10);assert(calls===1,'Overlapping prune');release();await waitFor(()=>worker.snapshot().runs>=3);await worker.close();const stopped=calls;await sleep(10)
  assert(maximum===1&&calls===stopped,'Work escaped ownership');assert(worker.snapshot().removed>=3&&observed===1&&worker.snapshot().errors===1,'Recovery counts');assert(worker.snapshot().state==='closed','Not closed');assert(!JSON.stringify(worker.snapshot()).includes('private'),'Private diagnostics')
  let close,settled=false,finish
  const reentrant=new IdempotencyCleanup({prune(){close=reentrant.close();void close.then(()=>{settled=true});return new Promise(done=>{finish=done})}});reentrant.start();await waitFor(()=>!!finish);await sleep(2);assert(!settled,'Closed before prune settlement');finish(0);await close;assert(settled,'Reentrant close did not drain')
  const problem=new Error('observer failed'),broken=new IdempotencyCleanup({async prune(){throw new Error('provider failed')}},{onError:async()=>{await sleep(1);throw problem}});broken.start();await waitFor(()=>broken.snapshot().observerErrors===1);let failure;try{await broken.close()}catch(error){failure=error}assert(failure===problem,'Observer failure was lost')
  return{singleFlight:true,recovered:true,closeDrained:true,reentrantClose:true,observerFailure:true,privateSnapshot:true}
}
