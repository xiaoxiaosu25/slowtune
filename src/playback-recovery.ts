import type { StudioPlayer } from '@studio/player/core';
import { PlaybackRecoveryController } from '@studio/player/recovery';
import { nextPlaybackOperation, invokingPlaybackOperation, type PlaybackDiagnostic } from './playback-diagnostics';

/** Product lifecycle and diagnostic identities wrap the public recovery controller. */
export class PlaybackRecovery extends PlaybackRecoveryController {
  constructor(player:StudioPlayer,audio:HTMLAudioElement,desktop:boolean|(()=>boolean)=false,observe:(event:PlaybackDiagnostic)=>void=()=>{}) {
    super(player,audio,{
      enabled:desktop,observe,nextOperationId:nextPlaybackOperation,currentOperationId:invokingPlaybackOperation,
      subscribe:listener=>typeof window==='undefined'?()=>{}:window.slowTuneDesktop?.onCommand(command=>{
        if(command==='suspend')listener('suspend');if(command==='resync')listener('resume');
      })??(()=>{}),
    });
  }
}
