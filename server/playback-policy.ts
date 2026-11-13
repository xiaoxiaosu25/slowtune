import type {DeliveryReadPolicy} from '@studio/music-sources/service';

/** Host-owned, memory-only first-block observations. Unknown egress uses TTL. */
export class PlaybackLineHistory {
  private records=new Map<string,{ready:number;failed:number;ms:number;until:number;cooldown:number}>();
  private scope='';
  constructor(private generation:()=>string,private now=Date.now){}
  policy():DeliveryReadPolicy{
    const scope=this.generation();if(scope!==this.scope){this.scope=scope;this.records.clear();}
    for(const [host,row]of this.records)if(row.until<=this.now())this.records.delete(host);
    return {candidateMs:6000,selectionMs:20000,maxFirstChunkBytes:262144,
      order:items=>[...items].sort((a,b)=>{
        const left=this.records.get(a.hostname),right=this.records.get(b.hostname),score=(value:typeof left)=>value?(value.cooldown>this.now()?-1:value.ready/(value.ready+value.failed)):0.5;
        return score(right)-score(left)||(left&&right?left.ms-right.ms:0)||a.index-b.index;
      }).map(item=>item.index),
      observe:fact=>{
        if(scope!==this.generation()||!fact.ready&&!['network','timeout','protocol','not-found','upstream'].includes(fact.errorCode??''))return;
        const previous=this.records.get(fact.hostname),row=previous??{ready:0,failed:0,ms:fact.elapsedMs,until:0,cooldown:0};
        if(fact.ready){row.ready++;row.ms=row.ms*.7+fact.elapsedMs*.3;row.cooldown=0;}else{row.failed++;row.cooldown=this.now()+Math.min(30000,row.failed*5000);}
        row.until=this.now()+300000;
        if(!previous&&this.records.size>=32)this.records.delete(this.records.keys().next().value!);
        this.records.set(fact.hostname,row);
      }};
  }
}
