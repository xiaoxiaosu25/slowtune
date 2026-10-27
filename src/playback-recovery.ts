import type { StudioPlayer } from '@studio/player/core';
import { nextPlaybackOperation, invokingPlaybackOperation, playbackFailureCode, type PlaybackDiagnostic } from './playback-diagnostics';

/** A live failure checkpoint only. New selections and page reloads start fresh. */
export class PlaybackRecovery {
  private checkpoint?: { resourceId: string; position: number; paused: boolean };
  private pending?: AbortSignal;
  private readonly unsubscribe: (() => void)[];
  private environment?:AbortController;
  private attempts=0;
  private lastAttempt=-Infinity;
  private disposed=false;
  private timer?:ReturnType<typeof setTimeout>;
  private sourceWork=0;
  private awaitingPlayback=false;
  private diagnosticOperation=nextPlaybackOperation();
  get diagnosticId(){return this.diagnosticOperation;}
  private record(code:string,detail:Partial<PlaybackDiagnostic>={}){try{this.observe({operation:'recovery',code,at:Date.now(),operationId:this.diagnosticId,...detail});}catch{/* Observers never own recovery. */}}

  constructor(private readonly player: StudioPlayer, private readonly audio: HTMLAudioElement, desktop:boolean|(()=>boolean)=false,private readonly observe:(event:PlaybackDiagnostic)=>void=()=>{}) {
    // Install before player.attach(): a terminal media error clears the element.
    const capture = () => {this.record('media-failure',{...(audio.error?{mediaCode:audio.error.code}:{})});this.capture(player.currentTime, !player.playbackRequested);};
    audio.addEventListener('error', capture);
    this.unsubscribe = [
      () => audio.removeEventListener('error', capture),
      player.on('loadstart', () => { this.cancelEnvironment('selection');this.diagnosticOperation=invokingPlaybackOperation()??nextPlaybackOperation();this.record('selection');this.checkpoint = undefined;this.awaitingPlayback=false;this.attempts=0; }),
      player.on('stop', () => { this.cancelEnvironment('stop');this.record('stopped');this.checkpoint = undefined;this.awaitingPlayback=false;this.attempts=0; }),
      player.on('playing', () => { if(this.awaitingPlayback)this.record('playback-resumed',{positionSeconds:player.currentTime,paused:player.paused});this.awaitingPlayback=false;this.checkpoint = undefined; }),
      player.on('resume', () => {if(this.checkpoint||this.pending)this.record('position-requested',{positionSeconds:player.currentTime,paused:player.paused});}),
      player.on('seeked', () => { if (!player.failed){if(this.checkpoint||this.pending)this.record('position-restored',{positionSeconds:player.currentTime,paused:!player.playbackRequested});this.checkpoint = undefined;} }),
      player.on('pauseintent', () => { if (this.checkpoint) this.checkpoint.paused = true; }),
      player.on('playintent', () => { if (this.checkpoint) this.checkpoint.paused = false; }),
    ];
    if(desktop){
      const enabled=()=>typeof desktop==='function'?desktop():desktop;
      const offline=()=>{this.cancelEnvironment('offline');if(enabled()&&!player.failed)this.capture(player.currentTime,!player.playbackRequested);};
      const resume=()=>{if(enabled())void this.environmentChanged().catch(()=>{});};
      const visible=()=>{if(document.visibilityState==='visible')resume();};
      window.addEventListener('offline',offline);window.addEventListener('online',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',visible);
      this.unsubscribe.push(()=>{window.removeEventListener('offline',offline);window.removeEventListener('online',resume);window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',visible);});
      const off=window.slowTuneDesktop?.onCommand(command=>{if(command==='suspend'){this.cancelEnvironment('suspend');if(enabled()&&!player.failed)this.capture(player.currentTime,!player.playbackRequested);}if(command==='resync')resume();});if(off)this.unsubscribe.push(off);
    }
  }

  capture(position: number, paused: boolean) {
    const resourceId = this.player.currentResourceId;
    if (!resourceId || !Number.isFinite(position) || position < 0) return;
    // A second error before the replacement reaches its checkpoint must not
    // replace that checkpoint with the empty element's zero position.
    if (this.checkpoint?.resourceId === resourceId && position === 0) return;
    this.checkpoint = { resourceId, position, paused };
    this.awaitingPlayback=true;
    this.record('checkpoint',{positionSeconds:position,paused});
  }

  get preparing() { return !!this.pending; }
  async trackSource<T>(task:()=>Promise<T>,reason:'retry'|'expired'|'fallback'='retry'):Promise<T>{
    const operationId=this.diagnosticId,start=performance.now();this.sourceWork++;this.record('source-start',{operationId,reason});
    try{const value=await task();this.record(value===null?'source-unavailable':'source-ready',{operationId,reason,elapsedMs:performance.now()-start});return value;}
    catch(error){this.record('source-failed',{operationId,reason,errorCode:playbackFailureCode(error),elapsedMs:performance.now()-start});throw error;}
    finally{this.sourceWork--;}
  }

  /** Coalesce network/wake notifications; healthy media needs no new source. */
  async environmentChanged(){
    const player=this.player;
    if(this.disposed||this.environment||this.pending||this.sourceWork||typeof navigator!=='undefined'&&navigator.onLine===false||!player.currentPlan||!player.canPrepareSource||['idle','stopped','ended','loading'].includes(player.state))return false;
    const checkpoint=this.checkpoint?.resourceId===player.currentResourceId?this.checkpoint:undefined;
    if(checkpoint?.paused||!player.playbackRequested&&!checkpoint)return false;
    const controller=new AbortController(),resource=player.currentResourceId,position=player.currentTime;
    this.environment=controller;
    try{
      const expired=!!player.currentPlan.expiresAt&&player.currentPlan.expiresAt<=Date.now()+5000;
      let broken=player.failed||!!this.audio.error||expired;
      if(!broken){
        await new Promise<void>(resolve=>{const finish=()=>{clearTimeout(this.timer);controller.signal.removeEventListener('abort',finish);resolve();};this.timer=setTimeout(finish,1500);controller.signal.addEventListener('abort',finish,{once:true});});
        broken=(player.playbackRequested||!!this.checkpoint&&!this.checkpoint.paused)&&(player.currentTime<=position+.05||player.failed);
      }
      if(!broken||this.sourceWork||controller.signal.aborted||resource!==player.currentResourceId||!player.playbackRequested&&!this.checkpoint||this.checkpoint?.paused||this.attempts>=2||Date.now()-this.lastAttempt<10000)return false;
      this.attempts++;this.lastAttempt=Date.now();
      const checkpoint=this.checkpoint?.resourceId===resource?this.checkpoint:{resourceId:resource!,position:player.currentTime,paused:!player.playbackRequested};
      const timeout=setTimeout(()=>controller.abort(new DOMException('Recovery timed out','TimeoutError')),30000);
      try{return await this.prepare(checkpoint,controller.signal,'environment');}finally{clearTimeout(timeout);}
    }finally{if(this.environment===controller)this.environment=undefined;}
  }
  cancelEnvironment(reason='cancelled'){if(this.environment)this.record('cancel-requested',{reason});this.environment?.abort();this.environment=undefined;clearTimeout(this.timer);}

  retry(signal: AbortSignal): Promise<boolean> | undefined {
    const checkpoint = this.checkpoint;
    if (!this.player.failed || !checkpoint || checkpoint.resourceId !== this.player.currentResourceId || !this.player.canPrepareSource) return;
    return this.prepare(checkpoint, signal);
  }

  private async prepare(checkpoint: NonNullable<PlaybackRecovery['checkpoint']>, signal: AbortSignal,reason='manual') {
    signal.throwIfAborted();
    const operationId=this.diagnosticId,start=performance.now();
    this.record('restore-start',{operationId,reason,positionSeconds:checkpoint.position,paused:checkpoint.paused,attempt:this.attempts});
    this.pending = signal;
    const cancel = () => this.player.sourceController.cancelSourcePreparation();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      if (checkpoint.paused) this.player.pause();
      else this.player.requestPlayback();
      // The public preparation command owns continuity, latest pause intent,
      // generation isolation and release of unused plans; selection stays intact.
      await this.player.prepareSource({ reason: 'seek', positionSeconds: checkpoint.position });
      signal.throwIfAborted();
      // Applying a plan completes before the media element finishes seeking.
      this.record('source-applied',{operationId,reason,positionSeconds:checkpoint.position,paused:!this.player.playbackRequested,elapsedMs:performance.now()-start});
      return true;
    } catch(error){this.record(signal.aborted?'restore-cancelled':'restore-failed',{operationId,reason,errorCode:playbackFailureCode(error,signal),elapsedMs:performance.now()-start});throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
      if (this.pending === signal) this.pending = undefined;
    }
  }

  dispose() { if(this.disposed)return;this.disposed=true;this.cancelEnvironment('disposed');this.record('disposed');this.unsubscribe.forEach(unsubscribe => unsubscribe()); }
}
