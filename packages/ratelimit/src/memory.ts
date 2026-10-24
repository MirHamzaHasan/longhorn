import type { RateLimitReservation,RateLimitStore,StoredRateLimit } from './types.js'
import { bounded,clock,RateLimitError,reservation } from './protocol.js'
type Bucket=RateLimitReservation&{id:string;attempts:number;resetsAt:number;index:number}
/** Process-local bounded state. Capacity never evicts a live admission window. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly maximum:number
  private readonly rows=new Map<string,Bucket>()
  private readonly heap:Bucket[]=[]
  constructor(options:{readonly maxEntries?:number}={}){this.maximum=bounded(options.maxEntries??10_000,100_000)}
  private less(a:Bucket,b:Bucket){return a.resetsAt<b.resetsAt||(a.resetsAt===b.resetsAt&&a.id<b.id)}
  private swap(a:number,b:number){const left=this.heap[a]!,right=this.heap[b]!;this.heap[a]=right;right.index=a;this.heap[b]=left;left.index=b}
  private up(index:number){while(index>0){const parent=(index-1)>>1;if(!this.less(this.heap[index]!,this.heap[parent]!))break;this.swap(index,parent);index=parent}}
  private down(index:number){while(true){const left=index*2+1;if(left>=this.heap.length)return;const right=left+1,child=right<this.heap.length&&this.less(this.heap[right]!,this.heap[left]!)?right:left;if(!this.less(this.heap[child]!,this.heap[index]!))return;this.swap(index,child);index=child}}
  private remove(row:Bucket){
    const index=row.index,last=this.heap.pop()!;this.rows.delete(row.id);row.index=-1
    if(last!==row){this.heap[index]=last;last.index=index;const parent=(index-1)>>1;if(index>0&&this.less(last,this.heap[parent]!))this.up(index);else this.down(index)}
  }
  async consume(input:RateLimitReservation,now:()=>number):Promise<StoredRateLimit>{
    const request=reservation(input),time=clock(now),id=request.scope+'\0'+request.key
    if(!Number.isSafeInteger(time+request.windowMs))throw new RateLimitError('INPUT')
    let row=this.rows.get(id)
    if(row&&row.resetsAt<=time){this.remove(row);row=undefined}
    if(row&&(row.limit!==request.limit||row.windowMs!==request.windowMs))throw new RateLimitError('POLICY_MISMATCH')
    if(!row){
      // At capacity, one earliest expired entry is enough to admit one new bucket.
      const expired=this.heap[0];if(this.rows.size>=this.maximum&&expired&&expired.resetsAt<=time)this.remove(expired)
      if(this.rows.size>=this.maximum)throw new RateLimitError('CAPACITY')
      row={...request,id,attempts:0,resetsAt:time+request.windowMs,index:this.heap.length};this.rows.set(id,row);this.heap.push(row);this.up(row.index)
    }
    row.attempts=Math.min(row.attempts+1,request.limit+1)
    return{allowed:row.attempts<=request.limit,remaining:Math.max(0,request.limit-row.attempts),resetsAt:row.resetsAt}
  }
  async prune(input:{readonly now:number;readonly limit:number}):Promise<number>{
    const time=bounded(input.now,Number.MAX_SAFE_INTEGER,0),limit=bounded(input.limit,10_000);let removed=0
    while(removed<limit&&this.heap[0]&&this.heap[0].resetsAt<=time){this.remove(this.heap[0]);removed++}
    return removed
  }
}
