import { desktopSurface } from './song-search';
import type { CallOptions, MusicApi, PreparedPlayback } from '@studio/music-sources';

export interface PlaybackDiagnostic {
  operation:string;code:string;at:number;elapsedMs?:number;serverOperation?:string;
  operationId?:string;requestId?:string;reason?:string;recovery?:string;errorCode?:string;
  timeoutSeconds?:number;positionSeconds?:number;paused?:boolean;attempt?:number;mediaCode?:number;
}
const events:PlaybackDiagnostic[]=[];
let sequence=0,requestSequence=0,invoking:string|undefined;
export const nextPlaybackOperation=()=>`playback-${++sequence}`;
export const nextSourceRequest=()=>`request-${++requestSequence}`;
export const invokingPlaybackOperation=()=>invoking;
// Only the synchronous API invocation owns this scope. Fetch captures it before
// awaiting; overlapping requests never share a mutable asynchronous context.
export function withPlaybackDiagnostic<T>(operationId:string|undefined,task:()=>T):T{
  const previous=invoking;invoking=operationId;try{return task();}finally{invoking=previous;}
}
const errorCodes=new Set(['invalid-input','not-found','authentication','restricted','rate-limited','network','upstream','unsupported','cancelled','timeout','disposed','busy','stale-cursor','expired','protocol']);
export function playbackFailureCode(error:unknown,signal?:AbortSignal){
  if(signal?.aborted)return signal.reason?.name==='TimeoutError'?'timeout':'cancelled';
  const value=error as {name?:string;code?:string}|undefined;
  if(value?.name==='TimeoutError')return 'timeout';if(value?.name==='AbortError')return 'cancelled';
  return value?.code&&errorCodes.has(value.code)?value.code:'unknown';
}
/** Session-only, bounded diagnostics. Never retain media URLs or track identities. */
export function recordPlaybackDiagnostic(event:PlaybackDiagnostic){
  if(!desktopSurface())return;
  const safe:PlaybackDiagnostic={operation:event.operation,code:event.code,at:event.at};
  for(const key of ['operationId','requestId','serverOperation'] as const){const value=event[key];if(typeof value==='string'&&/^(?:playback|request|desktop)-\d+$/.test(value))safe[key]=value;}
  for(const key of ['elapsedMs','timeoutSeconds','positionSeconds','attempt','mediaCode'] as const){const value=event[key];if(typeof value==='number'&&Number.isFinite(value)&&value>=0)safe[key]=value;}
  if(typeof event.paused==='boolean')safe.paused=event.paused;
  if(event.reason&&['expired','fallback','retry','manual','environment','selection','stop','offline','suspend','disposed','cancelled'].includes(event.reason))safe.reason=event.reason;
  if(event.recovery&&['fallback','none','limit'].includes(event.recovery))safe.recovery=event.recovery;
  if(event.errorCode&&(errorCodes.has(event.errorCode)||event.errorCode==='unknown'))safe.errorCode=event.errorCode;
  events.push(safe);if(events.length>120)events.shift();
}
export function playbackDiagnostics(){return events.map(event=>({...event}));}
export function sourceDiagnosticPath(path:string){return path.split('?')[0].replace(/^\/v1\/leases\/[^/]+$/,'/v1/leases/:lease');}
export function observeSourceRequest(path:string,response:Response,start:number,context:Pick<PlaybackDiagnostic,'operationId'|'requestId'>={}){
  recordPlaybackDiagnostic({operation:sourceDiagnosticPath(path),code:response.ok?'complete':'failure',at:Date.now(),elapsedMs:performance.now()-start,...context,...(response.headers.get('X-SlowTune-Operation')?{serverOperation:response.headers.get('X-SlowTune-Operation')!}:{})});
}
/** Product facade: preserve public API semantics and remember only temporary lease ownership. */
export function tracePlaybackApi(api:MusicApi,context:()=>string|undefined):MusicApi{
  const leases=new Map<string,string>();
  const signals=new WeakMap<AbortSignal,string>();
  return new Proxy(api,{get(target,property){
    const value=Reflect.get(target,property);if(typeof value!=='function')return value;
    if(!['metadata','formats','prepare','prepareDesktopAudio','release','touch'].includes(String(property)))return value.bind(target);
    return (...args:unknown[])=>{
      const signal=(args[1] as CallOptions|undefined)?.signal;
      const invocation=invokingPlaybackOperation()??(signal?signals.get(signal):undefined)??context();
      const operationId=desktopSurface()?(property==='release'||property==='touch'?leases.get(String(args[0]))??invocation:invocation):undefined;
      // formats and prepare can be separated by an await while another selection plays.
      if(signal&&operationId)signals.set(signal,operationId);
      const preparation=property==='prepare'||property==='prepareDesktopAudio';
      const start=performance.now(),operation='source-'+(preparation?'prepare':String(property));
      recordPlaybackDiagnostic({operation,code:'start',at:Date.now(),operationId});
      return Promise.resolve().then(()=>withPlaybackDiagnostic(operationId,()=>value.apply(target,args))).then(result=>{
        const lease=(result as PreparedPlayback|undefined)?.leaseId;
        if(preparation&&lease&&operationId){if(leases.size>=64)leases.delete(leases.keys().next().value!);leases.set(lease,operationId);}
        if(property==='release')leases.delete(String(args[0]));
        recordPlaybackDiagnostic({operation,code:'complete',at:Date.now(),operationId,elapsedMs:performance.now()-start});return result;
      },error=>{recordPlaybackDiagnostic({operation,code:'failure',at:Date.now(),operationId,errorCode:playbackFailureCode(error),elapsedMs:performance.now()-start});throw error;});
    };
  }});
}
