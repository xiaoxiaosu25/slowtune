import { MediaDelivery,type DeliveryReadPolicy } from '@studio/music-sources/service';
import { MusicSourceError, type CallOptions, type PreparedPlayback, type ProviderId } from '@studio/music-sources';
import type { BilibiliAccounts } from './bilibili-accounts.js';
import type {PlaybackFailureFact} from './audio-quality.js';

export function playbackContext(request: Request, provider: ProviderId | undefined, accounts: Pick<BilibiliAccounts, 'options'>, delivery: PlaybackDelivery): CallOptions {
  const path = new URL(request.url).pathname;
  if (provider === 'bilibili' && ['/v1/call/discover', '/v1/call/formats', '/v1/call/prepare'].includes(path)) return accounts.options();
  return delivery.context(request);
}

/** Media keeps the identity that created its lease, including across login changes. */
export class PlaybackDelivery extends MediaDelivery {
  private owners = new Map<string, string>();
  private providerLeases = new Map<string,ProviderId>();
  private desktopLeases = new Set<string>();
  private facts=new Map<string,{owner:string;generation:string;until:number;value?:PlaybackFailureFact;at?:number}>();
  private attempt=0;
  desktopContext?:()=>boolean;
  ownerContext?:()=>string|undefined;
  generation?:()=>string;
  policy?:()=>DeliveryReadPolicy;
  desktopReadTimeouts={connectMs:30000,firstByteMs:30000,idleMs:120000};
  enabled?: (provider:ProviderId) => boolean;
  canPublish?: (playback:PreparedPlayback) => boolean;
  context(request: Request): CallOptions {
    const match = /^\/v1\/(?:media|leases)\/([^/]+)(?:\/|$)/.exec(new URL(request.url).pathname);
    const credentialRef = match ? this.owners.get(match[1]) : undefined;
    return credentialRef ? { credentialRef } : {};
  }
  override async publish(playback: PreparedPlayback, baseUrl: string, options: CallOptions = {}) {
    const desktop=this.desktopContext?.()===true;
    if(this.enabled&&!this.enabled(playback.entry.ref.provider)||this.canPublish&&!this.canPublish(playback))throw new MusicSourceError({code:'unsupported',provider:playback.entry.ref.provider,retryable:false});
    const published = await super.publish(playback, baseUrl, options);
    if(published.leaseId)this.providerLeases.set(published.leaseId,playback.entry.ref.provider);
    if(published.leaseId&&desktop)this.desktopLeases.add(published.leaseId);
    if(this.enabled&&!this.enabled(playback.entry.ref.provider)||this.canPublish&&!this.canPublish(playback)){if(published.leaseId)await this.release(published.leaseId,options);throw new MusicSourceError({code:'unsupported',provider:playback.entry.ref.provider,retryable:false});}
    if (published.leaseId && options.credentialRef) this.owners.set(published.leaseId, options.credentialRef);
    const owner=this.ownerContext?.();
    if(published.leaseId&&desktop&&owner&&playback.entry.ref.provider==='bilibili'){
      this.pruneFacts();while(this.facts.size>=64)this.facts.delete(this.facts.keys().next().value!);
      this.facts.set(published.leaseId,{owner,generation:this.generation?.()??'',until:published.delivery.expiresAt??Date.now()+300000});
    }
    return published;
  }
  override async release(id: string, options?: CallOptions) {
    await super.release(id, options);
    this.owners.delete(id);
    this.providerLeases.delete(id);
    this.desktopLeases.delete(id);
    this.facts.delete(id);
  }
  private pruneFacts(){for(const [id,row]of this.facts)if(row.until<=Date.now())this.facts.delete(id);}
  override async touch(id:string,options?:CallOptions){await super.touch(id,options);const row=this.facts.get(id);if(row)row.until=Date.now()+300000;}
  failure(id:string,owner:string):PlaybackFailureFact|null{
    this.pruneFacts();const row=this.facts.get(id);
    if(!row||row.owner!==owner||row.generation!==(this.generation?.()??'')||!this.provider(id))return null;
    const value=row.value;if(!value)return null;
    return {...value,...(value.retryAfterMs!==undefined?{retryAfterMs:Math.max(0,value.retryAfterMs-(Date.now()-(row.at??Date.now())))}:{})};
  }
  override async read(id:string,request:Request,options?:CallOptions,resource?:string){
    const desktop=this.desktopLeases.has(id),bilibili=this.providerLeases.get(id)==='bilibili',record=request.method==='GET'?this.facts.get(id):undefined,fact:PlaybackFailureFact={attempt:++this.attempt,state:'pending',provider:'bilibili'};
    const policy=desktop&&bilibili?this.policy?.()??{candidateMs:6000,selectionMs:20000,maxFirstChunkBytes:262144}:undefined;
    if(record)record.value=fact;
    const failed=(error:unknown)=>{if(record?.value===fact&&this.facts.get(id)===record){fact.state='failed';record.at=Date.now();fact.code=error instanceof MusicSourceError?error.code:request.signal.aborted?'cancelled':'network';if(error instanceof MusicSourceError){if(error.upstreamCode&&/^\d{3}$/.test(error.upstreamCode))fact.status=Number(error.upstreamCode);if(error.retryAfterMs!==undefined)fact.retryAfterMs=error.retryAfterMs;}}};
    try{
      const result=await super.read(id,request,options,resource,desktop?this.desktopReadTimeouts:undefined,policy&&request.method==='HEAD'?{...policy,observe:undefined}:policy);
      if(record?.value===fact){fact.state='ready';fact.status=result.status;}
      if(record&&result.body){
        const reader=result.body.getReader(),body=new ReadableStream<Uint8Array>({async pull(controller){try{const chunk=await reader.read();if(chunk.done){if(record.value===fact)fact.state='complete';controller.close();}else controller.enqueue(chunk.value);}catch(error){failed(error);controller.error(error);}},async cancel(){await reader.cancel().catch(()=>{});}},{highWaterMark:0});
        return new Response(body,{status:result.status,headers:result.headers});
      }
      return result;
    }catch(error){
      failed(error);
      throw error;
    }
  }
  async releaseProvider(provider:ProviderId){await Promise.allSettled([...this.providerLeases].filter(([,value])=>value===provider).map(([id])=>this.release(id,this.owners.get(id)?{credentialRef:this.owners.get(id)}:{})));}
}
