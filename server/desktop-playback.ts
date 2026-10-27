import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { MusicSourceError, validateRef, type CallOptions, type MusicApi, type PreparedPlayback, type ProviderId, type SourceDiagnostic } from '@studio/music-sources';
import { prepareBestAudio, supportsAudioType, losslessAudio } from './audio-quality.js';
import { sameVideoPart } from './search-policy.js';
import { DesktopInflight, requestIdentity } from './desktop-inflight.js';
import { BilibiliResponseReuse } from '@studio/music-sources/bilibili';

export { desktopAudioCapability } from './audio-quality.js';
export const desktopOperationTimeoutMs = 60000;
export function desktopSourcePath(path:string){
  return /^\/v1\/(?:handshake|call\/[^/]+)$/.test(path)||[
    '/api/search','/api/search/resolve','/api/song-library/playback','/api/identify','/api/playback/prefetch',
    '/api/discovery/bilibili','/api/youtube/music','/api/creators/resolve',
    '/api/song-library/catalog/search','/api/song-library/catalog/backfill',
  ].includes(path);
}
type Priority = 0 | 1 | 2;
interface Work {
  id:string; owner:string; generation:string; signal:AbortSignal; priority:Priority;
  shared?:boolean;
  responseStatus?:number;
  responses:BilibiliResponseReuse;tickets:Set<string>;
}
interface Pending {provider:ProviderId;priority:Priority;signal:AbortSignal;start:()=>void;reject:(error:unknown)=>void;detach:()=>void}
interface Ticket {owner:string;generation:string;until:number;playback:PreparedPlayback}
type Event = {id:string;operation:string;code:string;at:number;elapsedMs?:number;provider?:ProviderId;status?:number;errorCode?:string;sourceRequest?:string;attempt?:number};
const cancelled = (signal:AbortSignal) => new MusicSourceError({code:signal.reason?.name==='TimeoutError'?'timeout':'cancelled',retryable:signal.reason?.name==='TimeoutError'});

/** Product-owned desktop work only. Normal browser/mobile source calls bypass it. */
export class DesktopPlayback {
  private context=new AsyncLocalStorage<Work>();
  private stop=new AbortController();
  private active=new Map<ProviderId,number>();
  private pending:Pending[]=[];
  private tickets=new Map<string,Ticket>();
  private events:Event[]=[];
  private sequence=0;
  private inflight=new DesktopInflight();
  private sharedWork=new Map<string,{priority:Priority;users:number;work?:Work}>();
  constructor(private generation:()=>string,private now=Date.now){}
  get current(){return this.context.getStore();}
  share<T>(identity:unknown,signal:AbortSignal,task:(signal:AbortSignal)=>Promise<T>):Promise<T>{
    const work=this.current;if(!work||work.shared)return task(signal);
    this.check(work);
    signal.throwIfAborted();
    const key=requestIdentity([work.owner,work.generation,identity]);
    let record=this.inflight.has(key)?this.sharedWork.get(key):undefined;
    if(!record){record={priority:work.priority,users:0};this.sharedWork.set(key,record);}
    if(work.priority>record.priority){record.priority=work.priority;if(record.work)record.work.priority=work.priority;this.pump();}
    const sharedRecord=record;sharedRecord.users++;
    return this.inflight.run(work.owner,key,AbortSignal.any([work.signal,signal]),shared=>this.run(work.owner,'shared',shared,async signal=>{
      const producer=this.current!;producer.shared=true;producer.priority=sharedRecord.priority;sharedRecord.work=producer;
      try{return await task(signal);}finally{if(this.sharedWork.get(key)===sharedRecord)this.sharedWork.delete(key);}
    },sharedRecord.priority)).finally(()=>{sharedRecord.users--;if(!sharedRecord.users&&this.sharedWork.get(key)===sharedRecord)this.sharedWork.delete(key);});
  }
  private record(event:Event){this.events.push(event);if(this.events.length>160)this.events.shift();}
  async run<T>(owner:string,operation:string,signal:AbortSignal,task:(signal:AbortSignal)=>Promise<T>,priority:Priority=2,timeoutMs=desktopOperationTimeoutMs):Promise<T>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new DOMException('Desktop operation timed out','TimeoutError')),timeoutMs);
    const combined=AbortSignal.any([signal,this.stop.signal,controller.signal]),id='desktop-'+ ++this.sequence;
    const responses=new BilibiliResponseReuse((...args)=>this.fetcher(...args),combined,()=>this.record({id,operation:'upstream',code:'reuse',at:this.now(),provider:'bilibili'}));
    const work:Work={id,owner,generation:this.generation(),signal:combined,priority,responses,tickets:new Set()};
    const start=this.now();
    return this.context.run(work,async()=>{
      this.record({id:work.id,operation,code:'start',at:start});
      try{combined.throwIfAborted();const result=await task(combined);this.check(work);this.record({id:work.id,operation,code:(work.responseStatus??200)>=400?'failure':'complete',at:this.now(),elapsedMs:this.now()-start,...(work.responseStatus?{status:work.responseStatus}:{})});return result;}
      catch(error){for(const token of work.tickets)this.tickets.delete(token);const failure=combined.aborted?cancelled(combined):error;this.record({id:work.id,operation,code:'failure',at:this.now(),elapsedMs:this.now()-start,errorCode:failure instanceof MusicSourceError?failure.code:'upstream'});throw failure;}
      finally{clearTimeout(timer);await work.responses.dispose();}
    });
  }
  response(status:number){const work=this.current;if(!work)return;work.responseStatus=status;if(status>=400)for(const token of work.tickets)this.tickets.delete(token);}
  private check(work:Work){if(work.signal.aborted)throw cancelled(work.signal);if(work.generation!==this.generation())throw new MusicSourceError({code:'cancelled',retryable:false});}
  /** Queue before entering MusicSources' four-call limit; leave a slot for playback. */
  call<T>(provider:ProviderId,options:CallOptions,task:(signal:AbortSignal)=>Promise<T>):Promise<T>{
    const work=this.current;
    if(!work)return task(options.signal??this.stop.signal);
    const signal=AbortSignal.any([work.signal,...(options.signal?[options.signal]:[])]);
    if(signal.aborted)return Promise.reject(cancelled(signal));
    if(this.pending.length>=64)return Promise.reject(new MusicSourceError({code:'busy',provider,retryable:true}));
    return new Promise<T>((resolve,reject)=>{
      const abort=()=>{const at=this.pending.indexOf(job);if(at<0)return;this.pending.splice(at,1);job.detach();reject(cancelled(signal));this.pump();};
      const job:Pending={provider,get priority(){return work.priority;},signal,reject,detach:()=>signal.removeEventListener('abort',abort),start:()=>{
        job.detach();this.active.set(provider,(this.active.get(provider)??0)+1);
        void (async()=>{
          // Legacy/background calls outside desktop scheduling may already own
          // the source's slots. Wait for capacity without retrying upstream errors.
          for(;;){
            this.check(work);signal.throwIfAborted();
            try{return await task(signal);}
            catch(error){if(!(error instanceof MusicSourceError)||error.code!=='busy')throw error;await new Promise<void>((done,fail)=>{const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);done();},40);const cancel=()=>{clearTimeout(timer);fail(cancelled(signal));};signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});}
          }
        })().then(resolve,reject).finally(()=>{this.active.set(provider,(this.active.get(provider)??1)-1);this.pump();});
      }};
      this.pending.push(job);signal.addEventListener('abort',abort,{once:true});this.pump();
    });
  }
  private pump(){
    this.pending.sort((a,b)=>b.priority-a.priority);
    for(let at=0;at<this.pending.length;){
      const job=this.pending[at],limit=job.provider==='youtube'?(job.priority===2?2:1):job.priority===2?4:3;
      if((this.active.get(job.provider)??0)>=limit){at++;continue;}
      this.pending.splice(at,1);job.start();
    }
  }
  /** Reuse only bounded public API bodies within this one desktop operation. */
  fetch:typeof fetch=async(input,init)=>{
    const work=this.current;
    if(!work)return this.fetcher(input,init);
    this.check(work);
    const response=await work.responses.fetch(input,init);this.check(work);return response;
  };
  private fetcher:typeof fetch=fetch;
  setFetch(fetcher:typeof fetch){this.fetcher=fetcher;}
  verified(playback:PreparedPlayback):string|undefined{
    const work=this.current;if(!work)return;
    this.check(work);this.prune();
    const until=Math.min(this.now()+15000,playback.delivery.expiresAt??Infinity);
    if(until-this.now()<1000)return;
    while(this.tickets.size>=32)this.tickets.delete(this.tickets.keys().next().value!);
    const token=randomBytes(24).toString('base64url');this.tickets.set(token,{owner:work.owner,generation:work.generation,until,playback});work.tickets.add(token);return token;
  }
  async prepare(api:MusicApi,request:Parameters<MusicApi['prepare']>[0],options:CallOptions,support:string[],token?:string){
    const work=this.current;if(!work)throw new MusicSourceError({code:'invalid-input',retryable:false});
    this.check(work);this.prune();validateRef(request?.ref);
    if(request.media!==undefined&&!['audio','video'].includes(request.media)||request.quality!==undefined&&!['highest','lowest','lossless'].includes(request.quality)||request.formatId!==undefined&&(typeof request.formatId!=='string'||!request.formatId||request.formatId.length>200)||request.codecs!==undefined&&(!Array.isArray(request.codecs)||request.codecs.length>20||request.codecs.some(codec=>typeof codec!=='string'||!codec||codec.length>80)))throw new MusicSourceError({code:'invalid-input',retryable:false});
    const ticket=token?this.tickets.get(token):undefined;
    if(ticket&&ticket.owner===work.owner&&ticket.generation===work.generation&&sameVideoPart(ticket.playback.entry.ref,request.ref)&&request.media!=='video'&&request.quality!=='lowest'&&(request.quality!=='lossless'||losslessAudio(ticket.playback.format))&&(!request.formatId||request.formatId===ticket.playback.format.id)&&(!request.codecs||request.codecs.some(codec=>ticket.playback.format.codec.toLowerCase().startsWith(codec.toLowerCase())))&&supportsAudioType(support,ticket.playback.format)){
      this.tickets.delete(token!);this.record({id:work.id,operation:'prepare',code:'verified-reuse',at:this.now(),provider:request.ref.provider});return ticket.playback;
    }
    return this.share(['best-audio',request,support,{...options,signal:undefined}],options.signal??work.signal,signal=>prepareBestAudio(api,request,{...options,signal},format=>supportsAudioType(support,format)));
  }
  observe(event:SourceDiagnostic){const work=this.current;if(work||event.operation==='media')this.record({id:work?.id??event.requestId,sourceRequest:event.requestId,operation:event.operation,code:event.code,at:event.timestamp,...(event.attempt!==undefined?{attempt:event.attempt}:{}),...(event.elapsedMs!==undefined?{elapsedMs:event.elapsedMs}:{}),...(event.provider?{provider:event.provider}:{}),...(event.status?{status:event.status}:{}),...(event.errorCode?{errorCode:event.errorCode}:{})});}
  private prune(){for(const [token,ticket]of this.tickets)if(ticket.until<=this.now()||ticket.generation!==this.generation())this.tickets.delete(token);}
  cancelOwner(owner:string){this.inflight.cancelOwner(owner);for(const [token,ticket]of this.tickets)if(ticket.owner===owner)this.tickets.delete(token);}
  diagnostics(){
    this.prune();
    const groups=new Map<string,number[]>();
    for(const event of this.events)if(event.code==='complete'&&event.elapsedMs!==undefined){const values=groups.get(event.operation)??[];values.push(event.elapsedMs);groups.set(event.operation,values);}
    const timings=Object.fromEntries([...groups].map(([operation,values])=>{values.sort((a,b)=>a-b);return [operation,{samples:values.length,p50:values[Math.ceil(values.length*.5)-1],p95:values[Math.ceil(values.length*.95)-1]}];}));
    return {active:[...this.active.values()].reduce((a,b)=>a+b,0),pending:this.pending.length,inflight:this.inflight.size,tickets:this.tickets.size,timings,events:this.events.map(event=>({...event}))};
  }
  discard(token:string){const work=this.current,ticket=this.tickets.get(token);if(work&&ticket?.owner===work.owner)this.tickets.delete(token);}
  dispose(){this.stop.abort();this.inflight.dispose();this.sharedWork.clear();this.tickets.clear();for(const job of this.pending.splice(0)){job.detach();job.reject(cancelled(this.stop.signal));}}
}
