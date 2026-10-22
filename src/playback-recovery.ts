import type { StudioPlayer } from '@studio/player/core';

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

  constructor(private readonly player: StudioPlayer, private readonly audio: HTMLAudioElement, desktop:boolean|(()=>boolean)=false) {
    // Install before player.attach(): a terminal media error clears the element.
    const capture = () => this.capture(player.currentTime, !player.playbackRequested);
    audio.addEventListener('error', capture);
    this.unsubscribe = [
      () => audio.removeEventListener('error', capture),
      player.on('loadstart', () => { this.cancelEnvironment();this.checkpoint = undefined;this.attempts=0; }),
      player.on('stop', () => { this.cancelEnvironment();this.checkpoint = undefined;this.attempts=0; }),
      player.on('playing', () => { this.checkpoint = undefined; }),
      player.on('seeked', () => { if (!player.failed) this.checkpoint = undefined; }),
      player.on('pauseintent', () => { if (this.checkpoint) this.checkpoint.paused = true; }),
      player.on('playintent', () => { if (this.checkpoint) this.checkpoint.paused = false; }),
    ];
    if(desktop){
      const enabled=()=>typeof desktop==='function'?desktop():desktop;
      const offline=()=>{this.cancelEnvironment();if(enabled()&&!player.failed)this.capture(player.currentTime,!player.playbackRequested);};
      const resume=()=>{if(enabled())void this.environmentChanged().catch(()=>{});};
      const visible=()=>{if(document.visibilityState==='visible')resume();};
      window.addEventListener('offline',offline);window.addEventListener('online',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',visible);
      this.unsubscribe.push(()=>{window.removeEventListener('offline',offline);window.removeEventListener('online',resume);window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',visible);});
      const off=window.slowTuneDesktop?.onCommand(command=>{if(command==='suspend'){this.cancelEnvironment();if(enabled()&&!player.failed)this.capture(player.currentTime,!player.playbackRequested);}if(command==='resync')resume();});if(off)this.unsubscribe.push(off);
    }
  }

  capture(position: number, paused: boolean) {
    const resourceId = this.player.currentResourceId;
    if (!resourceId || !Number.isFinite(position) || position < 0) return;
    // A second error before the replacement reaches its checkpoint must not
    // replace that checkpoint with the empty element's zero position.
    if (this.checkpoint?.resourceId === resourceId && position === 0) return;
    this.checkpoint = { resourceId, position, paused };
  }

  get preparing() { return !!this.pending; }
  async trackSource<T>(task:()=>Promise<T>):Promise<T>{this.sourceWork++;try{return await task();}finally{this.sourceWork--;}}

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
      const timeout=setTimeout(()=>controller.abort(),30000);
      try{return await this.prepare(checkpoint,controller.signal);}finally{clearTimeout(timeout);}
    }finally{if(this.environment===controller)this.environment=undefined;}
  }
  cancelEnvironment(){this.environment?.abort();this.environment=undefined;clearTimeout(this.timer);}

  retry(signal: AbortSignal): Promise<boolean> | undefined {
    const checkpoint = this.checkpoint;
    if (!this.player.failed || !checkpoint || checkpoint.resourceId !== this.player.currentResourceId || !this.player.canPrepareSource) return;
    return this.prepare(checkpoint, signal);
  }

  private async prepare(checkpoint: NonNullable<PlaybackRecovery['checkpoint']>, signal: AbortSignal) {
    signal.throwIfAborted();
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
      return true;
    } finally {
      signal.removeEventListener('abort', cancel);
      if (this.pending === signal) this.pending = undefined;
    }
  }

  dispose() { this.disposed=true;this.cancelEnvironment();this.unsubscribe.forEach(unsubscribe => unsubscribe()); }
}
