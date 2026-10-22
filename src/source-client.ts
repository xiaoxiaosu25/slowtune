import { MusicClient } from '@studio/music-sources/client';
import type { DesktopAudioApi } from '../server/audio-quality';
import { desktopSurface } from './song-search';
import { observeSourceRequest } from './playback-diagnostics';

export async function connectSourceClient(origin:string,lifetime:AbortSignal) {
  const client=await MusicClient.connect(origin,{
    signal:AbortSignal.any([lifetime,AbortSignal.timeout(10000)]),
    fetch:async(url,options)=>{
      const headers=new Headers(options?.headers),path=new URL(String(url),origin).pathname,start=performance.now();
      headers.set('X-Music-App','1');if(desktopSurface())headers.set('X-SlowTune-Surface','desktop');
      // Keep MusicClient's public result validation and cancellation. This local
      // envelope is removed before the protocol request leaves the browser.
      if(path==='/v1/call/prepare'&&typeof options?.body==='string'){
        const body=JSON.parse(options.body),audio=body.request?.slowTuneDesktopAudio;
        if(audio){delete body.request.slowTuneDesktopAudio;headers.set('X-SlowTune-Audio-Support',JSON.stringify(audio.support));if(audio.preparationToken)headers.set('X-SlowTune-Preparation',audio.preparationToken);options={...options,body:JSON.stringify(body)};}
      }
      const response=await fetch(url,{...options,signal:AbortSignal.any([lifetime,...(options?.signal?[options.signal]:[])]),headers});
      observeSourceRequest(path,response,start);
      if(response.headers.get('X-SlowTune-Session')==='expired')window.dispatchEvent(new Event('slowtune:session-expired'));
      return response;
    },
  });
  const desktop:DesktopAudioApi=client;
  desktop.prepareDesktopAudio=(request,options,support,preparationToken)=>client.prepare({...request,...{slowTuneDesktopAudio:{support,preparationToken}}},options);
  return client;
}
